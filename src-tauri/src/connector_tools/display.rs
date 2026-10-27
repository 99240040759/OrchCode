use serde_json::Value;

use crate::connector_tools::actions::Target;
use crate::connectors;
use crate::events::{ToolDisplayInfo, ToolIcon};

const MAX_TARGET_CHARS: usize = 160;

pub fn display_info(name: &str, args: &Value) -> Option<ToolDisplayInfo> {
    let def = connectors::def_for_slug(name)?;
    let (label, target_text) = match def.actions.iter().find(|action| action.slug == name) {
        Some(action) => (action.label.to_string(), target_text(action.target, args)),
        None => (humanize(name.strip_prefix(def.slug_prefix).unwrap_or(name)), None),
    };
    Some(ToolDisplayInfo {
        label,
        target_text,
        icon: ToolIcon::Globe,
        connector: Some(def.id.to_string()),
        ..Default::default()
    })
}

fn scalar(args: &Value, key: &str) -> Option<String> {
    match args.get(key)? {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn target_text(target: Target, args: &Value) -> Option<String> {
    let text = match target {
        Target::None => return None,
        Target::Key(key) => scalar(args, key)?,
        Target::Path(keys) => {
            let parts: Vec<String> = keys.iter().filter_map(|key| scalar(args, key)).collect();
            if parts.is_empty() {
                return None;
            }
            parts.join("/")
        }
    };
    Some(crate::util::truncate_chars(&text, MAX_TARGET_CHARS).to_string())
}

fn humanize(action: &str) -> String {
    let lowered = action.replace('_', " ").to_lowercase();
    let mut chars = lowered.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

