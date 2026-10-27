use std::path::Path;

use crate::error::{AppError, AppResult};

// Supported document extensions for parse_document_file.
// Legacy binary OLE2 formats (.doc, .ppt, .xls, .ods) are NOT listed here because
// office_oxide only handles OpenXML; spreadsheets go through calamine instead.
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
        return Ok(ext);
    }

    Err(AppError::UnsupportedFileType(format!(
        "'.{ext}' files are not supported. Supported: pdf, docx, xlsx, xls, ods, pptx"
    )))
}

/// Internal parsed representation — only `full_text` is used by callers.
struct ParsedDocument {
    full_text: String,
}

fn parse_document(path: &Path, file_type: &str) -> AppResult<ParsedDocument> {
    match file_type {
        "pdf" => parse_pdf(path),
        "docx" | "pptx" => parse_office_doc(path),
        // Spreadsheets: use calamine which handles xlsx, xls, and ods natively.
        "xlsx" | "xls" | "ods" => parse_spreadsheet_as_text(path),
        _ => Err(AppError::UnsupportedFileType(format!(
            "'.{file_type}' files are not supported. Supported: pdf, docx, xlsx, xls, ods, pptx"
        ))),
    }
}

fn parse_office_doc(path: &Path) -> AppResult<ParsedDocument> {
    let doc = office_oxide::Document::open(path)
        .map_err(|e| AppError::DocumentParseError(format!("Office document parse failed: {e}")))?;

    let full_text = doc.plain_text();
    Ok(ParsedDocument { full_text })
}

/// Use calamine to extract spreadsheet text for parse_document_file callers.
fn parse_spreadsheet_as_text(path: &Path) -> AppResult<ParsedDocument> {
    use calamine::{open_workbook_auto, Reader};

    let mut workbook = open_workbook_auto(path)
        .map_err(|e| AppError::DocumentParseError(format!("spreadsheet open failed: {e}")))?;
    let names = workbook.sheet_names().to_vec();
    let mut sections: Vec<String> = Vec::with_capacity(names.len());
    for name in names {
        let Ok(range) = workbook.worksheet_range(&name) else {
            continue;
        };
        let mut rows: Vec<String> = Vec::new();
        for row in range.rows() {
            let cells: Vec<String> = row.iter().map(format_calamine_cell).collect();
            if cells.iter().all(|c| c.is_empty()) {
                continue;
            }
            rows.push(cells.join("\t"));
        }
        if !rows.is_empty() {
            sections.push(format!("## {name}\n{}", rows.join("\n")));
        }
    }
    Ok(ParsedDocument {
        full_text: sections.join("\n\n"),
    })
}

fn parse_pdf(path: &Path) -> AppResult<ParsedDocument> {
    let pages = pdf_extract::extract_text_by_pages(path)
        .map_err(|e| AppError::DocumentParseError(format!("PDF text extraction failed: {e}")))?;
    let full_text = pages
        .iter()
        .map(|page| clean_pdf_text(page))
        .filter(|page| !page.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok(ParsedDocument { full_text })
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ParsedDocumentDto {
    pub full_text: String,
}

pub fn parse_document_file(path: &Path) -> AppResult<ParsedDocumentDto> {
    let canonical = dunce::canonicalize(path)
        .map_err(|e| AppError::DocumentParseError(format!("cannot resolve path: {e}")))?;
    let file_type = detect_file_type(&canonical)?;
    let parsed = parse_document(&canonical, &file_type)?;
    Ok(ParsedDocumentDto {
        full_text: parsed.full_text,
    })
}

pub fn is_parseable_document(path: &Path) -> bool {
    is_supported_document_extension(&crate::util::lowercase_extension(path))
}
