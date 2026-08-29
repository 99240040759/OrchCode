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

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

async fn persist_document(
    doc: DocumentRecord,
    text: &str,
    page_boundaries: Vec<(usize, usize)>,
    memory: &SqliteMemory,
) -> AppResult<usize> {
    let doc_id = doc.id.clone();
    let text_clone = text.to_string();
    let passages = tokio::task::spawn_blocking(move || {
        chunk_text_into_passages(&text_clone, &doc_id, page_boundaries)
    })
    .await
    .map_err(|e| AppError::DocumentParseError(format!("chunking task failed: {e}")))?;
    let count = passages.len();
    memory.replace_document_with_passages(doc, passages).await?;
    Ok(count)
}

pub async fn ingest_document(path: &Path, memory: &SqliteMemory) -> AppResult<IngestResult> {
    let canonical = dunce::canonicalize(path)
        .map_err(|e| AppError::DocumentParseError(format!("cannot resolve path: {e}")))?;
    let metadata = std::fs::metadata(&canonical).map_err(AppError::Io)?;
    if !metadata.is_file() {
        return Err(AppError::DocumentParseError(format!(
            "not a file: {}",
            canonical.display()
        )));
    }

    let canonical_path = canonical.to_string_lossy().into_owned();
    let file_type = detect_file_type(&canonical)?;
    let existing_id = memory.document_exists_by_path(&canonical_path).await?;
    let was_update = existing_id.is_some();
    let doc_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let size_bytes = metadata.len() as i64;

    let canonical_clone = canonical.clone();
    let file_type_clone = file_type.clone();
    let parsed = tokio::task::spawn_blocking(move || parse_document(&canonical_clone, &file_type_clone))
        .await
        .map_err(|e| AppError::DocumentParseError(format!("task failed: {e}")))??;

    let word_count = count_words(&parsed.full_text);
    let title = parsed.title.unwrap_or_else(|| file_stem_title(&canonical));
    let now = now_ms();

    let doc = DocumentRecord {
        id: doc_id.clone(),
        title: title.clone(),
        file_path: Some(canonical_path.clone()),
        source: "local".to_string(),
        source_id: None,
        file_type: file_type.clone(),
        size_bytes,
        page_count: parsed.page_count.map(|p| p as i64),
        word_count: Some(word_count as i64),
        metadata: serde_json::json!({ "path": canonical_path }),
        indexed_at: now,
        updated_at: now,
    };

    let passage_count = persist_document(doc, &parsed.full_text, parsed.page_boundaries, memory).await?;

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

    let passage_count = persist_document(doc, text, vec![], memory).await?;

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
        "txt" | "text" | "md" | "markdown" | "csv" | "json" | "html" | "htm" | "xml" | "rtf" => {
            Ok(ext)
        }
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
        "docx" => parse_office_zip(path, "word/document.xml", OfficeXmlKind::Word),
        "xlsx" => parse_xlsx(path),
        "pptx" => parse_office_zip(path, "", OfficeXmlKind::Pptx),
        _ => parse_plain_text(path),
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

    Ok(ParsedDocument { full_text, title: None, page_count: Some(page_count), page_boundaries })
}

fn clean_pdf_text(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

enum OfficeXmlKind {
    Word,
    Pptx,
}

fn parse_office_zip(path: &Path, _entry_hint: &str, kind: OfficeXmlKind) -> AppResult<ParsedDocument> {
    let data = std::fs::read(path).map_err(AppError::Io)?;
    let cursor = Cursor::new(data);
    let mut zip = ZipArchive::new(cursor)
        .map_err(|e| AppError::DocumentParseError(format!("ZIP open error: {e}")))?;

    let title = read_zip_entry(&mut zip, "docProps/core.xml")
        .ok()
        .and_then(|xml| extract_xml_element(&xml, "dc:title").ok())
        .filter(|t| !t.is_empty());

    match kind {
        OfficeXmlKind::Word => {
            let xml_text = read_zip_entry(&mut zip, "word/document.xml")?;
            let text = extract_office_text(&xml_text, false)?;
            Ok(ParsedDocument { full_text: text, title, page_count: None, page_boundaries: vec![] })
        }
        OfficeXmlKind::Pptx => {
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
                s.replace('\\', "/")
                    .trim_start_matches("ppt/slides/slide")
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
                let slide_text = extract_office_text(&xml, false)?;
                if !slide_text.trim().is_empty() {
                    full_text.push_str(&format!("=== Slide {slide_num} ===\n{slide_text}\n\n"));
                }
            }

            Ok(ParsedDocument {
                full_text,
                title,
                page_count: Some(slide_count),
                page_boundaries,
            })
        }
    }
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

fn extract_office_text(xml: &str, _is_pptx: bool) -> AppResult<String> {
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
                let lb = local.as_ref();
                match lb {
                    b"t" | b"delText" | b"instrText" => in_text = true,
                    b"p" => {
                        if !text.is_empty() && !text.ends_with('\n') {
                            text.push('\n');
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                let lb = local.as_ref();
                match lb {
                    b"br" | b"cr" => text.push('\n'),
                    b"tab" => text.push('\t'),
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local = e.local_name();
                let lb = local.as_ref();
                if matches!(lb, b"t" | b"delText" | b"instrText") {
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
            Ok(Event::Eof) | Err(_) => break,
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
                if e.local_name().as_ref() == tag_local {
                    in_target = true;
                }
            }
            Ok(Event::Text(e)) if in_target => {
                if let Ok(t) = e.unescape() {
                    result.push_str(&t);
                }
                in_target = false;
            }
            Ok(Event::Eof) | Err(_) => break,
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

fn parse_plain_text(path: &Path) -> AppResult<ParsedDocument> {
    let raw = std::fs::read(path).map_err(AppError::Io)?;
    let (cow, _, _) = encoding_rs::UTF_8.decode(&raw);
    Ok(ParsedDocument {
        full_text: cow.into_owned(),
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
    let mut start = 0usize;
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

            passages.push(PassageRecord {
                id: stable_passage_id(document_id, seq),
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

        start = floor_char_boundary(text, end.saturating_sub(PASSAGE_OVERLAP));
        while start < end {
            let Some(ch) = text[start..].chars().next() else { break };
            if ch.is_whitespace() { break }
            start += ch.len_utf8();
        }
        while start < text.len() {
            let Some(ch) = text[start..].chars().next() else { break };
            if !ch.is_whitespace() { break }
            start += ch.len_utf8();
        }
        if start >= end {
            start = end;
        }
    }

    passages
}

fn floor_char_boundary(text: &str, index: usize) -> usize {
    let mut boundary = index.min(text.len());
    while boundary > 0 && !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

fn find_chunk_end(text: &str, start: usize, max_chars: usize) -> usize {
    let target = (start + max_chars).min(text.len());
    let end = floor_char_boundary(text, target);
    if end >= text.len() {
        return text.len();
    }
    if let Some(pos) = text[start..end].rfind("\n\n") {
        return start + pos + 2;
    }
    if let Some(pos) = text[start..end].rfind('\n') {
        return start + pos + 1;
    }
    for delimiter in [". ", "! ", "? "] {
        if let Some(pos) = text[start..end].rfind(delimiter) {
            return start + pos + delimiter.len();
        }
    }
    if let Some((pos, ch)) = text[start..end]
        .char_indices()
        .rev()
        .find(|(_, ch)| ch.is_whitespace())
    {
        return start + pos + ch.len_utf8();
    }
    end
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ParsedDocumentDto {
    pub title: Option<String>,
    pub file_type: String,
    pub page_count: Option<usize>,
    pub full_text: String,
}

pub fn parse_document_file(path: &Path) -> AppResult<ParsedDocumentDto> {
    let canonical = dunce::canonicalize(path)
        .map_err(|e| AppError::DocumentParseError(format!("cannot resolve path: {e}")))?;
    let file_type = detect_file_type(&canonical)?;
    let parsed = parse_document(&canonical, &file_type)?;
    Ok(ParsedDocumentDto {
        title: parsed.title.or_else(|| Some(file_stem_title(&canonical))),
        file_type,
        page_count: parsed.page_count,
        full_text: parsed.full_text,
    })
}
