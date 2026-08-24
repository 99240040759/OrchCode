use std::io::{Cursor, Read};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::ZipArchive;

use crate::error::{AppError, AppResult};
use crate::persistence::{DocumentRecord, PassageRecord, SqliteMemory};

const CHARS_PER_TOKEN: usize = 4;
const PASSAGE_TOKENS: usize = 512;
const PASSAGE_CHARS: usize = PASSAGE_TOKENS * CHARS_PER_TOKEN;
const PASSAGE_OVERLAP: usize = 200;

#[derive(Debug, Clone)]
pub struct IngestResult {
    pub document_id: String,
    pub title: String,
    pub file_type: String,
    pub passage_count: usize,
    pub word_count: usize,
    pub page_count: Option<usize>,
    pub was_update: bool,
}

pub async fn ingest_document(path: &Path, memory: &SqliteMemory) -> AppResult<IngestResult> {
    let path_str = path.to_string_lossy().into_owned();
    let canonical = dunce::canonicalize(path)
        .map_err(|e| AppError::DocumentParseError(format!("cannot resolve path: {e}")))?;

    let file_type = detect_file_type(&canonical)?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|e| AppError::Io(e))?;
    let size_bytes = metadata.len() as i64;

    let was_update;
    let doc_id = if let Some(existing_id) = memory.document_exists_by_path(&path_str).await? {
        was_update = true;
        memory.delete_document(&existing_id).await?;
        existing_id
    } else {
        was_update = false;
        Uuid::new_v4().to_string()
    };

    let canonical_clone = canonical.clone();
    let file_type_clone = file_type.clone();
    let parsed = tokio::task::spawn_blocking(move || parse_document(&canonical_clone, &file_type_clone))
        .await
        .map_err(|e| AppError::DocumentParseError(format!("Task panicked: {e}")))??;

    let word_count = count_words(&parsed.full_text);
    let title = parsed
        .title
        .unwrap_or_else(|| file_stem_title(&canonical));

    let now = now_ms();

    let doc = DocumentRecord {
        id: doc_id.clone(),
        title: title.clone(),
        file_path: Some(path_str.clone()),
        source: "local".to_string(),
        source_id: None,
        file_type: file_type.clone(),
        size_bytes,
        page_count: parsed.page_count.map(|p| p as i64),
        word_count: Some(word_count as i64),
        metadata: serde_json::json!({ "path": path_str }),
        indexed_at: now,
        updated_at: now,
    };
    memory.upsert_document(doc).await?;

    let full_text_clone = parsed.full_text.clone();
    let doc_id_clone = doc_id.clone();
    let page_boundaries = parsed.page_boundaries.clone();
    let passages = tokio::task::spawn_blocking(move || {
        chunk_text_into_passages(&full_text_clone, &doc_id_clone, page_boundaries)
    })
    .await
    .map_err(|e| AppError::DocumentParseError(format!("Task panicked: {e}")))?;

    let passage_count = passages.len();
    memory.insert_passages(passages).await?;

    Ok(IngestResult {
        document_id: doc_id,
        title,
        file_type,
        passage_count,
        word_count,
        page_count: parsed.page_count,
        was_update,
    })
}

pub async fn ingest_remote_document(
    title: &str,
    source: &str,
    source_id: &str,
    file_type: &str,
    text: &str,
    memory: &SqliteMemory,
) -> AppResult<IngestResult> {
    let doc_id = Uuid::new_v4().to_string();
    let word_count = count_words(text);
    let now = now_ms();

    let doc = DocumentRecord {
        id: doc_id.clone(),
        title: title.to_string(),
        file_path: None,
        source: source.to_string(),
        source_id: Some(source_id.to_string()),
        file_type: file_type.to_string(),
        size_bytes: text.len() as i64,
        page_count: None,
        word_count: Some(word_count as i64),
        metadata: serde_json::json!({ "source_id": source_id }),
        indexed_at: now,
        updated_at: now,
    };
    memory.upsert_document(doc).await?;

    let doc_id_clone = doc_id.clone();
    let text_clone = text.to_string();
    let passages = tokio::task::spawn_blocking(move || {
        chunk_text_into_passages(&text_clone, &doc_id_clone, vec![])
    })
    .await
    .map_err(|e| AppError::DocumentParseError(format!("Task panicked: {e}")))?;

    let passage_count = passages.len();
    memory.insert_passages(passages).await?;

    Ok(IngestResult {
        document_id: doc_id,
        title: title.to_string(),
        file_type: file_type.to_string(),
        passage_count,
        word_count,
        page_count: None,
        was_update: false,
    })
}

fn detect_file_type(path: &Path) -> AppResult<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "pdf" => Ok("pdf".to_string()),
        "docx" | "doc" => Ok("docx".to_string()),
        "xlsx" | "xls" | "ods" => Ok("xlsx".to_string()),
        "pptx" | "ppt" => Ok("pptx".to_string()),
        "txt" | "text" => Ok("txt".to_string()),
        "md" | "markdown" => Ok("md".to_string()),
        "csv" => Ok("csv".to_string()),
        "json" => Ok("json".to_string()),
        "html" | "htm" => Ok("html".to_string()),
        "xml" => Ok("xml".to_string()),
        "rtf" => Ok("rtf".to_string()),
        _ => Err(AppError::UnsupportedFileType(format!(
            "'.{ext}' files are not supported. Supported: pdf, docx, xlsx, pptx, txt, md, csv, json, html"
        ))),
    }
}

struct ParsedDocument {
    full_text: String,
    title: Option<String>,
    page_count: Option<usize>,
    page_boundaries: Vec<(usize, usize)>,
}

fn parse_document(path: &Path, file_type: &str) -> AppResult<ParsedDocument> {
    match file_type {
        "pdf" => parse_pdf(path),
        "docx" => parse_docx(path),
        "xlsx" => parse_xlsx(path),
        "pptx" => parse_pptx(path),
        "csv" => parse_csv(path),
        "txt" | "md" | "json" | "xml" | "html" | "rtf" | "htm" => parse_plain_text(path),
        _ => Err(AppError::UnsupportedFileType(file_type.to_string())),
    }
}

fn parse_pdf(path: &Path) -> AppResult<ParsedDocument> {
    let doc = lopdf::Document::load(path)
        .map_err(|e| AppError::DocumentParseError(format!("PDF load failed: {e}")))?;

    let pages = doc.get_pages();
    let page_count = pages.len();
    let mut full_text = String::new();
    let mut page_boundaries = Vec::new();

    for (page_num, _page_id) in &pages {
        let page_offset = full_text.len();
        page_boundaries.push((page_offset, *page_num as usize));

        match doc.extract_text(&[*page_num]) {
            Ok(text) => {
                let cleaned = clean_pdf_text(&text);
                if !cleaned.trim().is_empty() {
                    full_text.push_str(&cleaned);
                    full_text.push('\n');
                }
            }
            Err(_) => {
                full_text.push_str(&format!("[Page {page_num}: image content — OCR not available]\n"));
            }
        }
    }

    Ok(ParsedDocument {
        full_text,
        title: None,
        page_count: Some(page_count),
        page_boundaries,
    })
}

fn clean_pdf_text(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_docx(path: &Path) -> AppResult<ParsedDocument> {
    let data = std::fs::read(path).map_err(AppError::Io)?;
    let cursor = Cursor::new(data);
    let mut zip = ZipArchive::new(cursor)
        .map_err(|e| AppError::DocumentParseError(format!("DOCX zip error: {e}")))?;

    let xml_text = read_zip_entry(&mut zip, "word/document.xml")?;
    let text = extract_text_from_word_xml(&xml_text)?;

    let title = read_zip_entry(&mut zip, "docProps/core.xml")
        .ok()
        .and_then(|xml| extract_xml_element(&xml, "dc:title").ok())
        .filter(|t| !t.is_empty());

    Ok(ParsedDocument {
        full_text: text,
        title,
        page_count: None,
        page_boundaries: vec![],
    })
}

fn read_zip_entry(zip: &mut ZipArchive<Cursor<Vec<u8>>>, name: &str) -> AppResult<String> {
    let mut entry = zip
        .by_name(name)
        .map_err(|e| AppError::DocumentParseError(format!("zip entry '{name}' not found: {e}")))?;
    let mut content = String::new();
    entry
        .read_to_string(&mut content)
        .map_err(|e| AppError::DocumentParseError(format!("zip read '{name}': {e}")))?;
    Ok(content)
}

fn extract_text_from_word_xml(xml: &str) -> AppResult<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut text = String::new();
    let mut in_text = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                let local_bytes = local.as_ref();
                if local_bytes == b"t" || local_bytes == b"delText" || local_bytes == b"instrText" {
                    in_text = true;
                } else if local_bytes == b"p" {
                    if !text.is_empty() && !text.ends_with('\n') {
                        text.push('\n');
                    }
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                let local_bytes = local.as_ref();
                if local_bytes == b"br" || local_bytes == b"cr" {
                    text.push('\n');
                } else if local_bytes == b"tab" {
                    text.push('\t');
                }
            }
            Ok(Event::End(ref e)) => {
                let local = e.local_name();
                let local_bytes = local.as_ref();
                if local_bytes == b"t" || local_bytes == b"delText" || local_bytes == b"instrText" {
                    in_text = false;
                }
            }
            Ok(Event::Text(e)) => {
                if in_text {
                    if let Ok(t) = e.unescape() {
                        text.push_str(&t);
                    }
                }
            }
            Ok(Event::CData(e)) => {
                if in_text {
                    if let Ok(t) = std::str::from_utf8(e.as_ref()) {
                        text.push_str(t);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(text)
}

fn extract_xml_element(xml: &str, tag: &str) -> AppResult<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    let mut in_target = false;
    let mut buf = Vec::new();
    let mut result = String::new();
    let tag_local = tag.split(':').last().unwrap_or(tag).as_bytes();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                if local.as_ref() == tag_local {
                    in_target = true;
                }
            }
            Ok(Event::Text(e)) if in_target => {
                if let Ok(t) = e.unescape() {
                    result.push_str(&t);
                }
                in_target = false;
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(result)
}

fn parse_xlsx(path: &Path) -> AppResult<ParsedDocument> {
    use calamine::{open_workbook_auto, Data, Reader};

    let mut workbook = open_workbook_auto(path)
        .map_err(|e| AppError::DocumentParseError(format!("XLSX open failed: {e}")))?;

    let sheet_names = workbook.sheet_names().to_vec();
    let mut full_text = String::new();

    for sheet_name in &sheet_names {
        if let Ok(range) = workbook.worksheet_range(sheet_name) {
            full_text.push_str(&format!("=== Sheet: {sheet_name} ===\n"));
            for row in range.rows() {
                let row_text: Vec<String> = row
                    .iter()
                    .map(|cell| match cell {
                        Data::Empty => String::new(),
                        Data::String(s) => s.clone(),
                        Data::Float(f) => {
                            if *f == f.floor() && f.abs() < 1e15 {
                                format!("{}", *f as i64)
                            } else {
                                format!("{f}")
                            }
                        }
                        Data::Int(i) => i.to_string(),
                        Data::Bool(b) => b.to_string(),
                        Data::DateTime(dt) => format!("{dt}"),
                        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
                        Data::Error(e) => format!("[err:{e:?}]"),
                    })
                    .filter(|s| !s.is_empty())
                    .collect();
                if !row_text.is_empty() {
                    full_text.push_str(&row_text.join("\t"));
                    full_text.push('\n');
                }
            }
            full_text.push('\n');
        }
    }

    Ok(ParsedDocument {
        full_text,
        title: None,
        page_count: Some(sheet_names.len()),
        page_boundaries: vec![],
    })
}

fn parse_pptx(path: &Path) -> AppResult<ParsedDocument> {
    let data = std::fs::read(path).map_err(AppError::Io)?;
    let cursor = Cursor::new(data);
    let mut zip = ZipArchive::new(cursor)
        .map_err(|e| AppError::DocumentParseError(format!("PPTX zip error: {e}")))?;

    let slide_names: Vec<String> = (0..zip.len())
        .filter_map(|i| {
            let entry = zip.by_index(i).ok()?;
            let raw_name = entry.name().replace('\\', "/");
            if raw_name.starts_with("ppt/slides/slide") && raw_name.ends_with(".xml") {
                Some(entry.name().to_string())
            } else {
                None
            }
        })
        .collect();

    let mut sorted_slides = slide_names;
    sorted_slides.sort_by_key(|s| {
        let clean = s.replace('\\', "/");
        clean.trim_start_matches("ppt/slides/slide")
            .trim_end_matches(".xml")
            .parse::<usize>()
            .unwrap_or(0)
    });

    let slide_count = sorted_slides.len();
    let mut full_text = String::new();
    let mut page_boundaries = Vec::new();

    for (idx, slide_name) in sorted_slides.iter().enumerate() {
        let slide_num = idx + 1;
        let offset = full_text.len();
        page_boundaries.push((offset, slide_num));

        let xml = read_zip_entry(&mut zip, slide_name)?;
        let slide_text = extract_text_from_pptx_slide(&xml)?;
        if !slide_text.trim().is_empty() {
            full_text.push_str(&format!("=== Slide {slide_num} ===\n{slide_text}\n\n"));
        }
    }

    let title = read_zip_entry(&mut zip, "docProps/core.xml")
        .ok()
        .and_then(|xml| extract_xml_element(&xml, "dc:title").ok())
        .filter(|t| !t.is_empty());

    Ok(ParsedDocument {
        full_text,
        title,
        page_count: Some(slide_count),
        page_boundaries,
    })
}

fn extract_text_from_pptx_slide(xml: &str) -> AppResult<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut text = String::new();
    let mut in_text = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                let local_bytes = local.as_ref();
                if local_bytes == b"t" {
                    in_text = true;
                } else if local_bytes == b"p" {
                    if !text.is_empty() && !text.ends_with('\n') {
                        text.push('\n');
                    }
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                let local_bytes = local.as_ref();
                if local_bytes == b"br" {
                    text.push('\n');
                }
            }
            Ok(Event::End(ref e)) => {
                let local = e.local_name();
                let local_bytes = local.as_ref();
                if local_bytes == b"t" {
                    in_text = false;
                }
            }
            Ok(Event::Text(e)) => {
                if in_text {
                    if let Ok(t) = e.unescape() {
                        text.push_str(&t);
                    }
                }
            }
            Ok(Event::CData(e)) => {
                if in_text {
                    if let Ok(t) = std::str::from_utf8(e.as_ref()) {
                        text.push_str(t);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(text)
}

fn parse_plain_text(path: &Path) -> AppResult<ParsedDocument> {
    let raw = std::fs::read(path).map_err(AppError::Io)?;
    let (cow, _, _) = encoding_rs::UTF_8.decode(&raw);
    let text = cow.into_owned();

    Ok(ParsedDocument {
        full_text: text,
        title: None,
        page_count: None,
        page_boundaries: vec![],
    })
}

fn parse_csv(path: &Path) -> AppResult<ParsedDocument> {
    let raw = std::fs::read(path).map_err(AppError::Io)?;
    let (cow, _, _) = encoding_rs::UTF_8.decode(&raw);
    let text = cow.into_owned();

    Ok(ParsedDocument {
        full_text: text,
        title: None,
        page_count: None,
        page_boundaries: vec![],
    })
}

fn chunk_text_into_passages(
    text: &str,
    document_id: &str,
    page_boundaries: Vec<(usize, usize)>,
) -> Vec<PassageRecord> {
    if text.trim().is_empty() {
        return vec![];
    }

    let mut passages = Vec::new();
    let mut start = 0;
    let mut seq = 0i64;

    while start < text.len() {
        let end = find_chunk_end(text, start, PASSAGE_CHARS);
        let chunk = &text[start..end];

        if !chunk.trim().is_empty() {
            let page_number = page_boundaries
                .iter()
                .rev()
                .find(|(offset, _)| *offset <= start)
                .map(|(_, page)| *page as i64);

            let passage_id = stable_passage_id(document_id, seq);

            passages.push(PassageRecord {
                id: passage_id,
                document_id: document_id.to_string(),
                seq,
                text: chunk.to_string(),
                page_number,
                char_start: Some(start as i64),
                char_end: Some(end as i64),
            });

            seq += 1;
        }

        if end >= text.len() {
            break;
        }
        start = end.saturating_sub(PASSAGE_OVERLAP);
        while start < end && !text[start..].starts_with(char::is_whitespace) {
            start += 1;
        }
        while start < text.len() && text[start..].starts_with(char::is_whitespace) {
            start += 1;
        }
        if start >= end {
            start = end;
        }
    }

    passages
}

fn find_chunk_end(text: &str, start: usize, max_chars: usize) -> usize {
    let end = (start + max_chars).min(text.len());
    if end >= text.len() {
        return text.len();
    }

    if let Some(pos) = text[start..end].rfind("\n\n") {
        return start + pos + 2;
    }

    if let Some(pos) = text[start..end].rfind('\n') {
        return start + pos + 1;
    }

    for delim in [". ", "! ", "? "] {
        if let Some(pos) = text[start..end].rfind(delim) {
            return start + pos + delim.len();
        }
    }

    let mut idx = end;
    while idx > start && !text[idx - 1..idx].contains(char::is_whitespace) {
        idx -= 1;
    }
    if idx == start {
        end
    } else {
        idx
    }
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn file_stem_title(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".to_string())
}

fn stable_passage_id(document_id: &str, seq: i64) -> String {
    let input = format!("{document_id}:{seq}");
    let hash = Sha256::digest(input.as_bytes());
    format!(
        "{:016x}",
        u64::from_be_bytes(hash[..8].try_into().unwrap_or([0u8; 8]))
    )
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ParsedDocumentDto {
    pub title: Option<String>,
    pub file_type: String,
    pub page_count: Option<usize>,
    pub full_text: String,
}

pub fn parse_document_file(path: &Path) -> AppResult<ParsedDocumentDto> {
    let canonical = dunce::canonicalize(path)
        .or_else(|_| Ok::<_, AppError>(path.to_path_buf()))?;
    let file_type = detect_file_type(&canonical)?;
    let parsed = parse_document(&canonical, &file_type)?;
    Ok(ParsedDocumentDto {
        title: parsed.title.or_else(|| Some(file_stem_title(&canonical))),
        file_type,
        page_count: parsed.page_count,
        full_text: parsed.full_text,
    })
}
