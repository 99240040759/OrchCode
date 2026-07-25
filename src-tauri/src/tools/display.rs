use std::path::Path;

use crate::events::{ToolDisplayInfo, ToolIcon};

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

fn str_arg(args: &serde_json::Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

pub fn parse_display_info(name: &str, args_json: &str) -> ToolDisplayInfo {
    let args: serde_json::Value = serde_json::from_str(args_json).unwrap_or_default();
    let tool_name = name.rsplit(':').next().unwrap_or(name);

    match tool_name {
        "read_file" => {
            let path = str_arg(&args, "path");
            let start = args.get("start_line").and_then(|n| n.as_u64());
            let end = args.get("end_line").and_then(|n| n.as_u64());
            let line_range = match (start, end) {
                (Some(s), Some(e)) => Some(format!("#L{s}-{e}")),
                (Some(s), None) => Some(format!("#L{s}")),
                _ => None,
            };
            ToolDisplayInfo {
                label: "Read".to_string(),
                filename: path.as_deref().map(basename),
                full_path: path,
                line_range,
                icon: ToolIcon::File,
                opens_artifact: false,
                ..Default::default()
            }
        }

        "write_file" => {
            let path = str_arg(&args, "path");
            let added_lines = args
                .get("content")
                .and_then(|v| v.as_str())
                .map(|c| c.lines().count() as u32)
                .filter(|n| *n > 0);
            ToolDisplayInfo {
                label: "Wrote".to_string(),
                filename: path.as_deref().map(basename),
                full_path: path,
                added_lines,
                icon: ToolIcon::File,
                opens_artifact: true,
                ..Default::default()
            }
        }

        "multi_replace_file_content" => {
            let path = str_arg(&args, "path");
            let mut added: u32 = 0;
            let mut removed: u32 = 0;
            if let Some(arr) = args.get("replacements").and_then(|v| v.as_array()) {
                for r in arr {
                    removed += r
                        .get("old_string")
                        .and_then(|s| s.as_str())
                        .map(|s| s.lines().count() as u32)
                        .unwrap_or(0);
                    added += r
                        .get("new_string")
                        .and_then(|s| s.as_str())
                        .map(|s| s.lines().count() as u32)
                        .unwrap_or(0);
                }
            }
            ToolDisplayInfo {
                label: "Edited".to_string(),
                filename: path.as_deref().map(basename),
                full_path: path,
                added_lines: if added > 0 { Some(added) } else { None },
                removed_lines: if removed > 0 { Some(removed) } else { None },
                icon: ToolIcon::File,
                opens_artifact: true,
                ..Default::default()
            }
        }

        "run_command" => ToolDisplayInfo {
            label: "Ran".to_string(),
            target_text: str_arg(&args, "command"),
            icon: ToolIcon::Terminal,
            opens_artifact: false,
            ..Default::default()
        },

        "stop_command" => ToolDisplayInfo {
            label: "Stopped Task".to_string(),
            target_text: str_arg(&args, "task_id"),
            icon: ToolIcon::ZapOff,
            opens_artifact: false,
            ..Default::default()
        },

        "get_command_status" => ToolDisplayInfo {
            label: "Task Status".to_string(),
            target_text: str_arg(&args, "task_id"),
            icon: ToolIcon::Cpu,
            opens_artifact: false,
            ..Default::default()
        },

        "read_skill" => ToolDisplayInfo {
            label: "Read Skill".to_string(),
            target_text: str_arg(&args, "name"),
            icon: ToolIcon::Book,
            opens_artifact: false,
            ..Default::default()
        },

        "web_search" => ToolDisplayInfo {
            label: "Searched Web".to_string(),
            target_text: str_arg(&args, "query"),
            icon: ToolIcon::Globe,
            opens_artifact: false,
            ..Default::default()
        },

        "search_workspace" => {
            let semantic = args
                .get("mode")
                .and_then(|v| v.as_str())
                .map(|m| m == "semantic")
                .unwrap_or(false);
            ToolDisplayInfo {
                label: if semantic {
                    "Semantic Search"
                } else {
                    "Searched Code"
                }
                .to_string(),
                target_text: str_arg(&args, "query"),
                icon: if semantic {
                    ToolIcon::Database
                } else {
                    ToolIcon::Search
                },
                opens_artifact: false,
                ..Default::default()
            }
        }

        "browser_navigate" => ToolDisplayInfo {
            label: "Navigated".to_string(),
            target_text: str_arg(&args, "url"),
            icon: ToolIcon::Globe,
            opens_artifact: true,
            ..Default::default()
        },

        "browser_click" => ToolDisplayInfo {
            label: "Clicked".to_string(),
            target_text: str_arg(&args, "selector"),
            icon: ToolIcon::MousePointer,
            opens_artifact: false,
            ..Default::default()
        },

        "browser_type" => {
            let selector = str_arg(&args, "selector").unwrap_or_default();
            let text = str_arg(&args, "text").unwrap_or_default();
            ToolDisplayInfo {
                label: "Typed".to_string(),
                target_text: Some(format!("'{text}' into {selector}")),
                icon: ToolIcon::Keyboard,
                opens_artifact: false,
                ..Default::default()
            }
        }

        "browser_get_content" => ToolDisplayInfo {
            label: "Browser Text".to_string(),
            icon: ToolIcon::Eye,
            opens_artifact: false,
            ..Default::default()
        },

        other => ToolDisplayInfo {
            label: other.to_string(),
            target_text: Some(args_json.chars().take(120).collect()),
            icon: ToolIcon::Terminal,
            opens_artifact: false,
            ..Default::default()
        },
    }
}
