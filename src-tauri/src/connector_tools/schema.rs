use rig::completion::ToolAnnotations;
use serde_json::{Map, Value};

const NOISE_KEYS: [&str; 4] = [
    "examples",
    "human_parameter_name",
    "human_parameter_description",
    "title",
];
const VERBATIM_KEYS: [&str; 3] = ["default", "enum", "const"];

pub fn trim_parameters(schema: Value) -> Result<Value, String> {
    let Value::Object(mut root) = schema else {
        return Err("tool input schema is not an object".to_string());
    };
    if root.get("type").and_then(Value::as_str) != Some("object") {
        return Err("tool input schema does not describe an object".to_string());
    }
    if !matches!(root.get("properties"), Some(Value::Object(_))) {
        return Err("tool input schema has no properties map".to_string());
    }
    root.remove("description");
    Ok(trim_schema(Value::Object(root)))
}

pub fn annotations_from_tags(tags: &[String]) -> ToolAnnotations {
    let has = |tag: &str| tags.iter().any(|candidate| candidate == tag);
    ToolAnnotations {
        title: None,
        read_only_hint: Some(has("readOnlyHint")),
        destructive_hint: Some(has("destructiveHint")),
        idempotent_hint: Some(has("idempotentHint")),
        open_world_hint: Some(true),
    }
}

fn trim_schema(value: Value) -> Value {
    match value {
        Value::Object(mut map) => {
            drop_file_uploads(&mut map);
            Value::Object(
                map.into_iter()
                    .filter(|(key, _)| !NOISE_KEYS.contains(&key.as_str()))
                    .map(|(key, child)| {
                        let child = if VERBATIM_KEYS.contains(&key.as_str()) {
                            child
                        } else if key == "properties" {
                            trim_properties(child)
                        } else {
                            trim_schema(child)
                        };
                        (key, child)
                    })
                    .collect(),
            )
        }
        Value::Array(items) => Value::Array(items.into_iter().map(trim_schema).collect()),
        other => other,
    }
}

fn trim_properties(value: Value) -> Value {
    match value {
        Value::Object(properties) => Value::Object(
            properties
                .into_iter()
                .map(|(name, schema)| (name, trim_schema(schema)))
                .collect(),
        ),
        other => trim_schema(other),
    }
}

fn contains_file_upload(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            map.get("file_uploadable").and_then(Value::as_bool) == Some(true)
                || map.values().any(contains_file_upload)
        }
        Value::Array(items) => items.iter().any(contains_file_upload),
        _ => false,
    }
}

fn drop_file_uploads(map: &mut Map<String, Value>) {
    let dropped: Vec<String> = match map.get("properties") {
        Some(Value::Object(properties)) => properties
            .iter()
            .filter(|(_, schema)| contains_file_upload(schema))
            .map(|(name, _)| name.clone())
            .collect(),
        _ => return,
    };
    if dropped.is_empty() {
        return;
    }
    if let Some(Value::Object(properties)) = map.get_mut("properties") {
        for name in &dropped {
            properties.remove(name);
        }
    }
    if let Some(Value::Array(required)) = map.get_mut("required") {
        required.retain(|entry| entry.as_str().is_none_or(|name| !dropped.iter().any(|d| d == name)));
    }
}

