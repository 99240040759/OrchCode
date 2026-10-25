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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strips_annotation_noise_but_keeps_a_property_named_title() {
        let schema = json!({
            "type": "object",
            "title": "CreateIssueRequest",
            "description": "Request model",
            "required": ["title"],
            "properties": {
                "title": {
                    "type": "string",
                    "title": "Title",
                    "description": "Issue title",
                    "examples": ["Bug"],
                    "human_parameter_name": "Issue title",
                    "human_parameter_description": "Provide a title"
                }
            }
        });
        let trimmed = trim_parameters(schema).unwrap();
        assert_eq!(
            trimmed,
            json!({
                "type": "object",
                "required": ["title"],
                "properties": { "title": { "type": "string", "description": "Issue title" } }
            })
        );
    }

    #[test]
    fn keeps_properties_named_properties_and_examples() {
        let schema = json!({
            "type": "object",
            "properties": {
                "properties": {
                    "type": "object",
                    "title": "Properties",
                    "additionalProperties": true
                },
                "examples": { "type": "array", "items": { "type": "string", "title": "Item" } }
            }
        });
        let trimmed = trim_parameters(schema).unwrap();
        assert_eq!(
            trimmed,
            json!({
                "type": "object",
                "properties": {
                    "properties": { "type": "object", "additionalProperties": true },
                    "examples": { "type": "array", "items": { "type": "string" } }
                }
            })
        );
    }

    #[test]
    fn leaves_default_and_enum_values_untouched() {
        let schema = json!({
            "type": "object",
            "properties": {
                "sort": {
                    "type": "string",
                    "title": "Sort",
                    "enum": ["title", "examples"],
                    "default": { "title": "x" }
                }
            }
        });
        let trimmed = trim_parameters(schema).unwrap();
        assert_eq!(
            trimmed["properties"]["sort"],
            json!({ "type": "string", "enum": ["title", "examples"], "default": { "title": "x" } })
        );
    }

    #[test]
    fn drops_file_upload_properties_and_their_required_entry() {
        let schema = json!({
            "type": "object",
            "required": ["to", "attachment"],
            "properties": {
                "to": { "type": "string" },
                "attachment": {
                    "anyOf": [
                        { "type": "object", "file_uploadable": true, "properties": { "s3key": { "type": "string" } } },
                        { "type": "array", "items": { "type": "object", "file_uploadable": true } }
                    ]
                },
                "file_to_upload": { "type": "object", "file_uploadable": true }
            }
        });
        let trimmed = trim_parameters(schema).unwrap();
        assert_eq!(
            trimmed,
            json!({
                "type": "object",
                "required": ["to"],
                "properties": { "to": { "type": "string" } }
            })
        );
    }

    #[test]
    fn accepts_an_empty_properties_map() {
        let schema = json!({ "type": "object", "title": "GetIssueTypesRequest", "properties": {}, "description": "d" });
        assert_eq!(
            trim_parameters(schema).unwrap(),
            json!({ "type": "object", "properties": {} })
        );
    }

    #[test]
    fn rejects_schemas_that_are_not_object_schemas() {
        assert!(trim_parameters(json!([])).is_err());
        assert!(trim_parameters(json!({ "type": "string", "properties": {} })).is_err());
        assert!(trim_parameters(json!({ "type": "object" })).is_err());
    }

    #[test]
    fn maps_tags_to_annotations() {
        let tags = vec!["readOnlyHint".to_string(), "idempotentHint".to_string(), "important".to_string()];
        let annotations = annotations_from_tags(&tags);
        assert!(annotations.read_only());
        assert!(!annotations.destructive());
        assert_eq!(annotations.open_world_hint, Some(true));

        let write = annotations_from_tags(&["destructiveHint".to_string()]);
        assert!(!write.read_only());
        assert!(write.destructive());
    }
}
