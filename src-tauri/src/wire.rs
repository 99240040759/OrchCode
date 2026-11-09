use serde_json::{json, Value};

use crate::tools::{BROWSE, EXECUTE_BASH, SEARCH};

pub fn call_step(id: &str, name: &str, arguments: Value) -> Value {
    match name {
        EXECUTE_BASH => json!({
            "type": "code_execution_call",
            "id": id,
            "arguments": {
                "language": "bash",
                "code": arguments.get("command").cloned().unwrap_or_else(|| json!("")),
            },
        }),
        SEARCH => json!({
            "type": "google_search_call",
            "id": id,
            "arguments": {
                "queries": arguments.get("queries").cloned().unwrap_or_else(|| json!([])),
            },
            "search_type": "web_search",
        }),
        BROWSE => json!({
            "type": "url_context_call",
            "id": id,
            "arguments": {
                "urls": arguments.get("urls").cloned().unwrap_or_else(|| json!([])),
            },
        }),
        _ => {
            let display = crate::connector_tools::display::display_info(name, &arguments);
            let mut step = json!({
                "type": "function_call",
                "id": id,
                "name": name,
                "arguments": arguments,
            });
            if let Some(display) = display {
                step["display"] = serde_json::to_value(display).unwrap_or(Value::Null);
            }
            step
        }
    }
}

pub fn result_step(call_id: &str, name: &str, is_error: bool, output: &str) -> Value {
    match name {
        EXECUTE_BASH => json!({
            "type": "code_execution_result",
            "call_id": call_id,
            "is_error": is_error,
            "result": output,
        }),
        SEARCH => json!({
            "type": "google_search_result",
            "call_id": call_id,
            "result": [],
            "is_error": is_error,
        }),
        BROWSE => json!({
            "type": "url_context_result",
            "call_id": call_id,
            "result": [],
            "is_error": is_error,
        }),
        _ => json!({
            "type": "function_result",
            "call_id": call_id,
            "name": name,
            "is_error": is_error,
            "result": output,
        }),
    }
}
