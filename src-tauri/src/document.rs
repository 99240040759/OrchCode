use std::path::Path;

use orchharness::error::{AppError, AppResult};

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
        .map_err(|e| AppError::other(format!("spreadsheet open failed: {e}")))?;
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
