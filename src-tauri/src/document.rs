use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;

use zip::ZipArchive;

use crate::error::{AppError, AppResult};

pub const MAX_DECOMPRESSED_ENTRY_BYTES: u64 = 25 * 1024 * 1024;
pub const SUPPORTED_DOCUMENT_EXTENSIONS: &[&str] = &["pdf", "docx", "xlsx", "xls", "ods", "pptx"];

pub fn document_type_info(file_type: &str) -> (Option<String>, String) {
    let normalized = file_type.to_ascii_lowercase();
    let artifact_kind = match normalized.as_str() {
        "pdf" => Some("pdf"),
        "docx" => Some("docx"),
        "xlsx" | "xls" | "ods" => Some("xlsx"),
        "pptx" => Some("pptx"),
        _ => None,
    }
    .map(str::to_string);
    let label = match normalized.as_str() {
        "pdf" => "PDF",
        "docx" => "Word",
        "xlsx" | "xls" => "Excel",
        "ods" => "Spreadsheet",
        "pptx" => "PowerPoint",
        "txt" | "text" => "Text",
        "md" | "markdown" => "Markdown",
        "csv" => "CSV",
        "json" => "JSON",
        "html" | "htm" => "HTML",
        "xml" => "XML",
        "rtf" => "RTF",
        _ => return (artifact_kind, normalized.to_uppercase()),
    };
    (artifact_kind, label.to_string())
}

pub fn is_supported_document_extension(ext: &str) -> bool {
    SUPPORTED_DOCUMENT_EXTENSIONS.contains(&ext)
}

fn detect_file_type(path: &Path) -> AppResult<String> {
    let ext = crate::util::lowercase_extension(path);

    if is_supported_document_extension(&ext) {
        let canonical = match ext.as_str() {
            "xls" | "ods" => "xlsx",
            other => other,
        };
        return Ok(canonical.to_string());
    }

    match ext.as_str() {
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
        "docx" => parse_office_zip(path, OfficeXmlKind::Word),
        "xlsx" => parse_xlsx(path),
        "pptx" => parse_office_zip(path, OfficeXmlKind::Pptx),
        _ => parse_plain_text(path),
    }
}

fn parse_pdf_from_bytes(bytes: &[u8]) -> AppResult<ParsedDocument> {
    let doc = lopdf::Document::load_mem(bytes)
        .map_err(|e| AppError::DocumentParseError(format!("PDF load failed: {e}")))?;

    let pages = doc.get_pages();
    let page_count = pages.len();
    let mut full_text = String::new();
    let mut page_boundaries = Vec::new();

    for (page_num, _page_id) in &pages {
        if let Ok(text) = doc.extract_text(&[*page_num]) {
            let cleaned = clean_pdf_text(&text);
            if !cleaned.trim().is_empty() {
                let page_offset = full_text.len();
                page_boundaries.push((page_offset, *page_num as usize));
                full_text.push_str(&cleaned);
                full_text.push('\n');
            }
        }
    }

    Ok(ParsedDocument { full_text, title: None, page_count: Some(page_count), page_boundaries })
}

fn parse_pdf(path: &Path) -> AppResult<ParsedDocument> {
    let bytes = std::fs::read(path).map_err(AppError::Io)?;
    parse_pdf_from_bytes(&bytes)
}

fn clean_pdf_text(text: &str) -> String {
    text.lines()
        .filter_map(|line| {
            let words: Vec<String> = line
                .split_whitespace()
                .map(|w| w.chars().filter(|c| !c.is_control() || *c == '\t').collect())
                .filter(|w: &String| !w.is_empty())
                .collect();
            if words.is_empty() {
                None
            } else {
                Some(words.join(" "))
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

enum OfficeXmlKind {
    Word,
    Pptx,
}

fn parse_office_zip_from_bytes(bytes: &[u8], kind: OfficeXmlKind) -> AppResult<ParsedDocument> {
    let cursor = Cursor::new(bytes);
    let mut zip = ZipArchive::new(cursor)
        .map_err(|e| AppError::DocumentParseError(format!("ZIP open error: {e}")))?;

    let title = read_zip_entry(&mut zip, "docProps/core.xml")
        .ok()
        .and_then(|xml| extract_xml_element(&xml, "dc:title").ok())
        .filter(|t| !t.is_empty());

    match kind {
        OfficeXmlKind::Word => {
            let xml_text = read_zip_entry(&mut zip, "word/document.xml")?;
            let text = extract_office_text(&xml_text)?;
            Ok(ParsedDocument { full_text: text, title, page_count: None, page_boundaries: vec![] })
        }
        OfficeXmlKind::Pptx => {
            let sorted_slides = ordered_pptx_slides(&mut zip);
            let slide_count = sorted_slides.len();
            let mut full_text = String::new();
            let mut page_boundaries = Vec::new();

            for (idx, slide_name) in sorted_slides.iter().enumerate() {
                let slide_num = idx + 1;
                let xml = read_zip_entry(&mut zip, slide_name)?;
                let slide_text = extract_office_text(&xml)?;
                if !slide_text.trim().is_empty() {
                    let offset = full_text.len();
                    page_boundaries.push((offset, slide_num));
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

fn parse_office_zip(path: &Path, kind: OfficeXmlKind) -> AppResult<ParsedDocument> {
    let data = std::fs::read(path).map_err(AppError::Io)?;
    parse_office_zip_from_bytes(&data, kind)
}

fn ordered_pptx_slides<R: Read + std::io::Seek>(zip: &mut ZipArchive<R>) -> Vec<String> {
    if let (Ok(pres_xml), Ok(rels_xml)) = (
        read_zip_entry(zip, "ppt/presentation.xml"),
        read_zip_entry(zip, "ppt/_rels/presentation.xml.rels"),
    ) {
        let mut rid_to_target: HashMap<String, String> = HashMap::new();
        use quick_xml::events::Event;
        use quick_xml::Reader;

        let mut rels_reader = Reader::from_str(&rels_xml);
        let mut buf = Vec::new();
        while let Ok(event) = rels_reader.read_event_into(&mut buf) {
            match event {
                Event::Start(ref e) | Event::Empty(ref e) if e.local_name().as_ref() == b"Relationship" => {
                    let mut id = None;
                    let mut target = None;
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"Id" {
                            id = std::str::from_utf8(&attr.value).ok().map(String::from);
                        } else if attr.key.as_ref() == b"Target" {
                            target = std::str::from_utf8(&attr.value).ok().map(String::from);
                        }
                    }
                    if let (Some(id), Some(target)) = (id, target) {
                        let normalized_target = if target.starts_with('/') {
                            target.trim_start_matches('/').to_string()
                        } else if target.starts_with("ppt/") {
                            target
                        } else {
                            format!("ppt/{target}")
                        };
                        rid_to_target.insert(id, normalized_target);
                    }
                }
                Event::Eof => break,
                _ => {}
            }
            buf.clear();
        }

        let mut ordered = Vec::new();
        let mut pres_reader = Reader::from_str(&pres_xml);
        while let Ok(event) = pres_reader.read_event_into(&mut buf) {
            match event {
                Event::Start(ref e) | Event::Empty(ref e) if e.local_name().as_ref() == b"sldId" => {
                    for attr in e.attributes().flatten() {
                        if attr.key.local_name().as_ref() == b"id" && attr.key.as_ref().starts_with(b"r:") {
                            if let Ok(rid) = std::str::from_utf8(&attr.value) {
                                if let Some(target) = rid_to_target.get(rid) {
                                    ordered.push(target.clone());
                                }
                            }
                        }
                    }
                }
                Event::Eof => break,
                _ => {}
            }
            buf.clear();
        }

        if !ordered.is_empty() {
            return ordered;
        }
    }

    let mut slide_names: Vec<String> = zip
        .file_names()
        .filter(|name| {
            let norm = name.replace('\\', "/");
            norm.starts_with("ppt/slides/slide") && norm.ends_with(".xml")
        })
        .map(String::from)
        .collect();

    slide_names.sort_by_key(|s| {
        let norm = s.replace('\\', "/");
        norm.strip_prefix("ppt/slides/slide")
            .and_then(|p| p.strip_suffix(".xml"))
            .and_then(|n| n.parse::<usize>().ok())
            .unwrap_or(0)
    });

    slide_names
}

fn read_zip_entry<R: Read + std::io::Seek>(zip: &mut ZipArchive<R>, name: &str) -> AppResult<String> {
    let mut entry = zip
        .by_name(name)
        .map_err(|e| AppError::DocumentParseError(format!("zip entry '{name}' not found: {e}")))?;
    let mut content = String::new();
    let read_bytes = entry
        .by_ref()
        .take(MAX_DECOMPRESSED_ENTRY_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|e| AppError::DocumentParseError(format!("zip read '{name}': {e}")))?;
    if read_bytes as u64 > MAX_DECOMPRESSED_ENTRY_BYTES {
        return Err(AppError::FileTooLarge(format!(
            "zip entry '{name}' exceeds maximum decompressed size limit of {} MB",
            MAX_DECOMPRESSED_ENTRY_BYTES / (1024 * 1024)
        )));
    }
    Ok(content)
}

fn extract_office_text(xml: &str) -> AppResult<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut text = String::new();
    let mut in_text = false;
    let mut skip_depth: usize = 0;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                let lb = local.as_ref();
                match lb {
                    b"del" | b"delText" | b"instrText" => skip_depth += 1,
                    b"t" if skip_depth == 0 => in_text = true,
                    b"p" => {
                        if !text.is_empty() && !text.ends_with('\n') {
                            text.push('\n');
                        }
                    }
                    b"tc" => {
                        if !text.is_empty() && !text.ends_with('\t') && !text.ends_with('\n') {
                            text.push('\t');
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                let lb = local.as_ref();
                if skip_depth == 0 {
                    match lb {
                        b"br" | b"cr" => text.push('\n'),
                        b"tab" => text.push('\t'),
                        _ => {}
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let local = e.local_name();
                let lb = local.as_ref();
                match lb {
                    b"del" | b"delText" | b"instrText" => {
                        skip_depth = skip_depth.saturating_sub(1);
                    }
                    b"t" => {
                        in_text = false;
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                if in_text && skip_depth == 0 {
                    if let Ok(t) = e.unescape() {
                        text.push_str(&t);
                    }
                }
            }
            Ok(Event::CData(e)) => {
                if in_text && skip_depth == 0 {
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
            Ok(Event::End(ref e)) => {
                if e.local_name().as_ref() == tag_local {
                    in_target = false;
                }
            }
            Ok(Event::Text(e)) if in_target => {
                if let Ok(t) = e.unescape() {
                    result.push_str(&t);
                }
            }
            Ok(Event::CData(e)) if in_target => {
                if let Ok(t) = std::str::from_utf8(e.as_ref()) {
                    result.push_str(t);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(result)
}

fn format_calamine_cell(cell: &calamine::Data) -> String {
    use calamine::Data;
    match cell {
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
        Data::Error(e) => format!("#{e:?}"),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetSheet {
    pub name: String,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
    pub truncated: bool,
}

pub fn read_spreadsheet(path: &Path, max_rows: usize, max_cols: usize) -> AppResult<Vec<SpreadsheetSheet>> {
    use calamine::{open_workbook_auto, Reader};

    let mut workbook = open_workbook_auto(path)
        .map_err(|e| AppError::DocumentParseError(format!("spreadsheet open failed: {e}")))?;
    let names = workbook.sheet_names().to_vec();
    let mut sheets = Vec::with_capacity(names.len());
    for name in names {
        let Ok(range) = workbook.worksheet_range(&name) else {
            continue;
        };
        let mut rows = Vec::new();
        let mut total_rows = 0usize;
        for row in range.rows() {
            let cells: Vec<String> = row
                .iter()
                .take(max_cols)
                .map(format_calamine_cell)
                .collect();
            if cells.iter().all(|c| c.is_empty()) {
                continue;
            }
            total_rows += 1;
            if rows.len() < max_rows {
                rows.push(cells);
            }
        }
        sheets.push(SpreadsheetSheet {
            name,
            truncated: total_rows > rows.len(),
            total_rows,
            rows,
        });
    }
    Ok(sheets)
}

fn parse_xlsx(path: &Path) -> AppResult<ParsedDocument> {
    let sheets = read_spreadsheet(path, usize::MAX, usize::MAX)?;
    let mut full_text = String::new();
    for sheet in &sheets {
        full_text.push_str(&format!("=== Sheet: {} ===\n", sheet.name));
        for row in &sheet.rows {
            let non_empty: Vec<&str> = row.iter().map(String::as_str).filter(|s| !s.is_empty()).collect();
            if !non_empty.is_empty() {
                full_text.push_str(&non_empty.join("\t"));
                full_text.push('\n');
            }
        }
        full_text.push('\n');
    }
    Ok(ParsedDocument {
        full_text,
        title: None,
        page_count: Some(sheets.len()),
        page_boundaries: vec![],
    })
}

fn parse_plain_text_from_bytes(bytes: &[u8]) -> AppResult<ParsedDocument> {
    let (cow, _, _) = encoding_rs::UTF_8.decode(bytes);
    Ok(ParsedDocument {
        full_text: cow.into_owned(),
        title: None,
        page_count: None,
        page_boundaries: vec![],
    })
}

fn parse_plain_text(path: &Path) -> AppResult<ParsedDocument> {
    let raw = std::fs::read(path).map_err(AppError::Io)?;
    parse_plain_text_from_bytes(&raw)
}

fn file_stem_title(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".to_string())
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

pub fn is_parseable_document(path: &Path) -> bool {
    is_supported_document_extension(&crate::util::lowercase_extension(path))
}
