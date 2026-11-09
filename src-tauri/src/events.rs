use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    pub connector: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct ChatEvent(pub Value);

impl ChatEvent {
    fn object(event_type: &str, fields: Value) -> Self {
        let mut map = match fields {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        map.insert("event_type".to_string(), Value::String(event_type.to_string()));
        Self(Value::Object(map))
    }

    pub fn from_sse(event: Option<&str>, data: &str) -> Option<Self> {
        let kind = event.map(str::trim).filter(|name| !name.is_empty());
        if kind == Some("done") {
            return Some(Self::done());
        }
        let Ok(Value::Object(mut map)) = serde_json::from_str::<Value>(data.trim()) else {
            return None;
        };
        if let Some(kind) = kind {
            map.entry("event_type".to_string())
                .or_insert_with(|| Value::String(kind.to_string()));
        }
        map.get("event_type").and_then(Value::as_str)?;
        Some(Self(Value::Object(map)))
    }

    pub fn event_type(&self) -> &str {
        self.0
            .get("event_type")
            .and_then(Value::as_str)
            .unwrap_or_default()
    }

    pub fn is_done(&self) -> bool {
        self.event_type() == "done"
    }

    pub fn step_start(index: i64, step: Value) -> Self {
        Self::object("step.start", json!({ "index": index, "step": step }))
    }

    pub fn step_delta(index: i64, delta: Value) -> Self {
        Self::object("step.delta", json!({ "index": index, "delta": delta }))
    }

    pub fn step_stop(index: i64, extra: Value) -> Self {
        let mut map = Map::new();
        map.insert("index".to_string(), json!(index));
        if let Value::Object(extra) = extra {
            for (key, value) in extra {
                map.insert(key, value);
            }
        }
        Self::object("step.stop", Value::Object(map))
    }

    pub fn usage(usage: Value, step_usage: Value) -> Self {
        Self::object("orch.usage", json!({ "usage": usage, "step_usage": step_usage }))
    }

    pub fn notice(message: impl Into<String>) -> Self {
        Self::object("orch.notice", json!({ "message": message.into() }))
    }

    pub fn compacted(
        original_message_count: usize,
        ts: i64,
        message_id: Option<String>,
        item_id: Option<String>,
    ) -> Self {
        Self::object(
            "orch.compacted",
            json!({
                "original_message_count": original_message_count,
                "ts": ts,
                "message_id": message_id,
                "item_id": item_id,
            }),
        )
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self::object(
            "error",
            json!({ "error": { "message": message.into(), "code": "local" } }),
        )
    }

    pub fn cancelled() -> Self {
        Self::object("interaction.status_update", json!({ "status": "cancelled" }))
    }

    pub fn resync() -> Self {
        Self::object("orch.resync", json!({ "reason": "reconnect" }))
    }

    pub fn done() -> Self {
        Self::object("done", json!({}))
    }
}

pub trait EventSink: Send + Sync {
    fn send(&self, event: ChatEvent);
    fn emit_file_written(&self, _path: &str) {}
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DictationEvent {
    Final { text: String },
    Error { message: String },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    Data { data: String },
    Exit,
}
