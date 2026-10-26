use std::path::Path;

use crate::error::{AppError, AppResult};

pub const MAX_DECOMPRESSED_ENTRY_BYTES: u64 = 25 * 1024 * 1024;
pub const SUPPORTED_DOCUMENT_EXTENSIONS: &[&str] = &["pdf", "docx", "doc", "xlsx", "xls", "ods", "pptx", "ppt"];

pub fn document_type_info(file_type: &str) -> (Option<String>, String) {
    let normalized = file_type.to_ascii_lowercase();
    let artifact_kind = match normalized.as_str() {
        "pdf" => Some("pdf"),
        "docx" | "doc" => Some("docx"),
        "xlsx" | "xls" | "ods" => Some("xlsx"),
        "pptx" | "ppt" => Some("pptx"),
        _ => None,
    }
    .map(str::to_string);
    let label = match normalized.as_str() {
        "pdf" => "PDF",
        "docx" | "doc" => "Word",
        "xlsx" | "xls" => "Excel",
        "ods" => "Spreadsheet",
        "pptx" | "ppt" => "PowerPoint",
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
            "doc" => "docx",
            "ppt" => "pptx",
            other => other,
        };
        return Ok(canonical.to_string());
    }

    match ext.as_str() {
        "txt" | "text" | "md" | "markdown" | "csv" | "json" | "html" | "htm" | "xml" | "rtf" => {
            Ok(ext)
        }
        _ => Err(AppError::UnsupportedFileType(format!(
            "'.{ext}' files are not supported. Supported: pdf, docx, doc, xlsx, pptx, ppt, txt, md, csv, json, html"
        ))),
    }
}

struct ParsedDocument {
    full_text: String,
    title: Option<String>,
    page_count: Option<usize>,
}

fn parse_document(path: &Path, file_type: &str) -> AppResult<ParsedDocument> {
    match file_type {
        "pdf" => parse_pdf(path),
        "docx" | "doc" | "pptx" | "ppt" => parse_office_doc(path),
        "xlsx" => parse_xlsx(path),
        _ => parse_plain_text(path),
    }
}

fn parse_office_doc(path: &Path) -> AppResult<ParsedDocument> {
    let doc = office_oxide::Document::open(path)
        .map_err(|e| AppError::DocumentParseError(format!("Office document parse failed: {e}")))?;
    let full_text = doc.plain_text();
    Ok(ParsedDocument {
        full_text,
        title: None,
        page_count: None,
    })
}

fn parse_pdf_from_bytes(bytes: &[u8]) -> AppResult<ParsedDocument> {
    let doc = lopdf::Document::load_mem(bytes)
        .map_err(|e| AppError::DocumentParseError(format!("PDF load failed: {e}")))?;

    let pages = doc.get_pages();
    let page_count = pages.len();
    let mut full_text = String::new();

    for (page_num, _page_id) in &pages {
        if let Ok(text) = doc.extract_text(&[*page_num]) {
            let cleaned = clean_pdf_text(&text);
            if !cleaned.trim().is_empty() {
                full_text.push_str(&cleaned);
                full_text.push('\n');
            }
        }
    }

    Ok(ParsedDocument { full_text, title: None, page_count: Some(page_count) })
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
    })
}

fn parse_plain_text_from_bytes(bytes: &[u8]) -> AppResult<ParsedDocument> {
    let (cow, _, _) = encoding_rs::UTF_8.decode(bytes);
    Ok(ParsedDocument {
        full_text: cow.into_owned(),
        title: None,
        page_count: None,
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
