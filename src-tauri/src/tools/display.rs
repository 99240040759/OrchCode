use std::path::Path;
use crate::events::{ToolDisplayInfo, ToolIcon};

fn file_total_lines(workspace: &Path, path_str: &str) -> Option<usize> {
    if path_str.is_empty() { return None; }
    let resolved = workspace.join(path_str);
    let meta = std::fs::metadata(&resolved).ok()?;
    if meta.len() > 100_000 || !meta.is_file() { return None; }
    let content = std::fs::read_to_string(resolved).ok()?;
    let count = content.lines().count();
    if count > 0 { Some(count) } else { None }
}

fn file_exists_in_workspace(workspace: &Path, path_str: &str) -> bool {
    if path_str.is_empty() { return false; }
    workspace.join(path_str).exists()
}

pub fn parse_display_info(name: &str, args_json: &str, workspace: Option<&Path>) -> ToolDisplayInfo {
    let args: serde_json::Value = serde_json::from_str(args_json).unwrap_or_default();
    let ws = workspace.unwrap_or_else(|| Path::new("."));

    let basename = |path: &str| -> String {
        Path::new(path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(path)
            .to_string()
    };

    let tool_name = name.split(':').last().unwrap_or(name);

    match tool_name {
        "read_file" => {
            let path = args.get("path").and_then(|s| s.as_str()).unwrap_or("");
            let s = args.get("start_line").and_then(|n| n.as_u64());
            let e = args.get("end_line").and_then(|n| n.as_u64());
            let line_range = match (s, e) {
                (Some(s), Some(e)) => Some(format!("#L{s}-{e}")),
                (Some(s), None) => Some(format!("#L{s}")),
                _ => file_total_lines(ws, path).map(|total| format!("#L1-{total}")),
            };
            ToolDisplayInfo {
                label: "Read".to_string(),
                filename: if path.is_empty() { None } else { Some(basename(path)) },
                full_path: if path.is_empty() { None } else { Some(path.to_string()) },
                line_range,
                icon: ToolIcon::File,
                opens_artifact: false,
                ..Default::default()
            }
        }

        "write_file" => {
            let path = args.get("path").and_then(|s| s.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|s| s.as_str()).unwrap_or("");
            let added_lines = if content.is_empty() { None } else { Some(content.lines().count() as u32) };
            let existed = file_exists_in_workspace(ws, path);
            ToolDisplayInfo {
                label: if existed { "Overwrote" } else { "Created" }.to_string(),
                filename: if path.is_empty() { None } else { Some(basename(path)) },
                full_path: if path.is_empty() { None } else { Some(path.to_string()) },
                added_lines,
                removed_lines: if existed { Some(0) } else { None },
                icon: ToolIcon::File,
                opens_artifact: true,
                ..Default::default()
            }
        }

        "multi_replace_file_content" => {
            let path = args.get("path").and_then(|s| s.as_str()).unwrap_or("");
            let mut added: u32 = 0;
            let mut removed: u32 = 0;
            if let Some(arr) = args.get("replacements").and_then(|v| v.as_array()) {
                for r in arr {
                    let old = r.get("old_string").and_then(|s| s.as_str()).unwrap_or("");
                    let new = r.get("new_string").and_then(|s| s.as_str()).unwrap_or("");
                    removed += old.lines().count() as u32;
                    added += new.lines().count() as u32;
                }
            }
            ToolDisplayInfo {
                label: "Edited".to_string(),
                filename: if path.is_empty() { None } else { Some(basename(path)) },
                full_path: if path.is_empty() { None } else { Some(path.to_string()) },
                added_lines: if added > 0 { Some(added) } else { None },
                removed_lines: if removed > 0 { Some(removed) } else { None },
                icon: ToolIcon::File,
                opens_artifact: true,
                ..Default::default()
            }
        }

        "run_command" => {
            let cmd = args.get("command").and_then(|s| s.as_str()).unwrap_or(args_json).to_string();
            ToolDisplayInfo {
                label: "Ran".to_string(),
                target_text: Some(cmd),
                icon: ToolIcon::Terminal,
                opens_artifact: false,
                ..Default::default()
            }
        }

        "stop_command" => {
            let id = args.get("task_id").and_then(|s| s.as_str()).unwrap_or(args_json).to_string();
            ToolDisplayInfo {
                label: "Stopped Task".to_string(),
                target_text: Some(id),
                icon: ToolIcon::ZapOff,
                opens_artifact: false,
                ..Default::default()
            }
        }

        "read_skill" => {
            let name = args.get("name").and_then(|s| s.as_str()).unwrap_or(args_json).to_string();
            ToolDisplayInfo {
                label: "Read Skill".to_string(),
                target_text: Some(name),
                icon: ToolIcon::Book,
                opens_artifact: false,
                ..Default::default()
            }
        }

        "web_search" => {
            let query = args.get("query").and_then(|s| s.as_str()).unwrap_or(args_json).to_string();
            ToolDisplayInfo {
                label: "Searched Web".to_string(),
                target_text: Some(query),
                icon: ToolIcon::Globe,
                ..Default::default()
            }
        }

        "search_workspace" => {
            let query = args.get("query").and_then(|s| s.as_str()).unwrap_or(args_json).to_string();
            let mode = args.get("mode").and_then(|s| s.as_str()).unwrap_or("text");
            let label = if mode == "semantic" { "Semantic Search" } else { "Searched Code" };
            let icon = if mode == "semantic" { ToolIcon::Database } else { ToolIcon::Search };
            ToolDisplayInfo {
                label: label.to_string(),
                target_text: Some(query),
                icon,
                ..Default::default()
            }
        }

        "get_command_status" => {
            let id = args.get("task_id").and_then(|s| s.as_str()).unwrap_or(args_json).to_string();
            ToolDisplayInfo {
                label: "Task Status".to_string(),
                target_text: Some(id),
                icon: ToolIcon::Cpu,
                opens_artifact: false,
                ..Default::default()
            }
        }

        "browser_navigate" => {
            let url = args.get("url").and_then(|s| s.as_str()).unwrap_or(args_json).to_string();
            ToolDisplayInfo {
                label: "Navigated".to_string(),
                target_text: Some(url),
                icon: ToolIcon::Globe,
                opens_artifact: true,
                ..Default::default()
            }
        }

        "browser_click" => {
            let sel = args.get("selector").and_then(|s| s.as_str()).unwrap_or(args_json).to_string();
            ToolDisplayInfo {
                label: "Clicked".to_string(),
                target_text: Some(sel),
                icon: ToolIcon::MousePointer,
                ..Default::default()
            }
        }

        "browser_type" => {
            let sel = args.get("selector").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let txt = args.get("text").and_then(|s| s.as_str()).unwrap_or("").to_string();
            ToolDisplayInfo {
                label: "Typed".to_string(),
                target_text: Some(format!("'{txt}' into {sel}")),
                icon: ToolIcon::Keyboard,
                ..Default::default()
            }
        }

        "browser_get_content" => ToolDisplayInfo {
            label: "Browser Text".to_string(),
            icon: ToolIcon::Eye,
            ..Default::default()
        },

        _ => ToolDisplayInfo {
            label: name.to_string(),
            target_text: Some(args_json.chars().take(120).collect()),
            icon: ToolIcon::Terminal,
            ..Default::default()
        },
    }
}
