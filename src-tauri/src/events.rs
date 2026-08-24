use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolDisplayInfo {
    pub label: String,
    pub filename: Option<String>,
    pub full_path: Option<String>,
    pub line_range: Option<String>,
    pub added_lines: Option<u32>,
    pub removed_lines: Option<u32>,
    pub target_text: Option<String>,
    pub icon: ToolIcon,
    pub opens_artifact: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ToolIcon {
    #[default]
    File,
    Folder,
    Terminal,
    Search,
    Globe,
    Book,
    Cpu,
    ZapOff,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatEvent {
    Text {
        delta: String,
    },
    Reasoning {
        delta: String,
    },
    #[serde(rename_all = "camelCase")]
    ReasoningDone {
        duration_seconds: u64,
    },
    #[serde(rename_all = "camelCase")]
    ToolCall {
        id: String,
        name: String,
        args: String,
        display_info: ToolDisplayInfo,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        id: String,
        output: String,
        is_error: bool,
    },
    #[serde(rename_all = "camelCase")]
    Usage {
        input_tokens: u64,
        output_tokens: u64,
        total_tokens: u64,
    },
    #[serde(rename_all = "camelCase")]
    Compacted {
        original_message_count: usize,
        ts: i64,
    },
    Done,
    Cancelled,
    Error {
        message: String,
    },
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DictationEvent {
    Final { text: String },
    Error { message: String },
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Data { data: String },
    Exit,
}
