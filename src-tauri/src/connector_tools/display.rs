use serde_json::Value;

use crate::connector_tools::actions::Target;
use crate::connectors;
use crate::events::{ToolDisplayInfo, ToolIcon};

const MAX_TARGET_CHARS: usize = 160;

pub fn display_info(name: &str, args: &Value) -> Option<ToolDisplayInfo> {
    let def = connectors::def_for_slug(name)?;
    let (label, target_text) = match def.actions.iter().find(|action| action.slug == name) {
        Some(action) => (action.label.to_string(), target_text(action.target, args)),
        None => (humanize(&name[def.slug_prefix.len()..]), None),
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn labels_an_allowlisted_action_with_its_target() {
        let info = display_info("GITHUB_CREATE_AN_ISSUE", &json!({ "title": "Crash on start", "owner": "a" })).unwrap();
        assert_eq!(info.label, "Created issue");
        assert_eq!(info.target_text.as_deref(), Some("Crash on start"));
        assert_eq!(info.connector.as_deref(), Some("github"));
        assert!(!info.opens_artifact);
    }

    #[test]
    fn joins_path_targets_and_stringifies_numbers() {
        let info = display_info(
            "GITHUB_GET_A_PULL_REQUEST",
            &json!({ "owner": "acme", "repo": "web", "pull_number": 42 }),
        )
        .unwrap();
        assert_eq!(info.target_text.as_deref(), Some("acme/web/42"));
    }

    #[test]
    fn leaves_the_target_empty_when_arguments_are_missing() {
        let info = display_info("SLACK_LIST_ALL_CHANNELS", &json!({})).unwrap();
        assert_eq!(info.label, "Listed channels");
        assert_eq!(info.target_text, None);
        let info = display_info("GITHUB_GET_REPOSITORY_CONTENT", &json!({})).unwrap();
        assert_eq!(info.target_text, None);
    }

    #[test]
    fn humanizes_actions_that_left_the_allowlist() {
        let info = display_info("GITHUB_DELETE_A_REPOSITORY", &json!({ "repo": "x" })).unwrap();
        assert_eq!(info.label, "Delete a repository");
        assert_eq!(info.connector.as_deref(), Some("github"));
        assert_eq!(info.target_text, None);
    }

    #[test]
    fn ignores_tools_that_are_not_connector_tools() {
        assert!(display_info("read_file", &json!({})).is_none());
        assert!(display_info("STRIPE_CREATE_CUSTOMER", &json!({})).is_none());
    }

    #[test]
    fn truncates_long_targets() {
        let jql = "x".repeat(500);
        let info = display_info("JIRA_SEARCH_ISSUES", &json!({ "jql": jql })).unwrap();
        assert_eq!(info.target_text.unwrap().chars().count(), MAX_TARGET_CHARS);
    }
}
