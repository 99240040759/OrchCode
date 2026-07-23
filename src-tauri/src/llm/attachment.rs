//! Structured attachment references sent from the frontend over the `start_chat` IPC
//! call. Replaces the previous scheme of embedding `[Attached file: name — path]`
//! marker lines directly in the prompt text and regex-parsing them back out on the Rust
//! side — the frontend already knows exactly which files were attached (it built the
//! attachment chips), so that list is passed as a typed parameter instead of round-tripped
//! through a text format designed for the model, not for IPC.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    pub path: String,
    pub name: String,
    pub is_image: bool,
}
