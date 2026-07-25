use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub path: String,
    pub name: String,
    pub is_image: bool,
}

pub const FILE_PART_PREFIX: &str = "<file:";
pub const PDF_PART_PREFIX: &str = "<pdf:";
pub const NOTE_PART_PREFIX: &str = "<note>";

pub fn is_payload_part(text: &str) -> bool {
    text.starts_with(FILE_PART_PREFIX)
        || text.starts_with(PDF_PART_PREFIX)
        || text.starts_with(NOTE_PART_PREFIX)
}

pub fn payload_part_label(text: &str) -> Option<String> {
    let rest = text
        .strip_prefix(FILE_PART_PREFIX)
        .or_else(|| text.strip_prefix(PDF_PART_PREFIX))?;
    let end = rest.find('>')?;
    let label = &rest[..end];
    if label.is_empty() {
        None
    } else {
        Some(label.to_string())
    }
}
