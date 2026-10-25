use rig::completion::ToolAnnotations;
use rig::message::ToolName;
use rig::tool::{DynamicTool, ToolExecutionError, ToolOutput};
use serde_json::Value;

use crate::connector_tools::client::{ComposioClient, ComposioError, ToolWire};
use crate::connector_tools::schema::{annotations_from_tags, trim_parameters};
use crate::error::{AppError, AppResult};

const ACCOUNT_NOT_FOUND_CODE: &str = "ActionExecute_ConnectedAccountNotFound";

#[derive(Debug, Clone)]
pub struct ToolSpec {
    pub slug: String,
    pub description: String,
    pub version: String,
    pub parameters: Value,
    pub annotations: ToolAnnotations,
}

impl ToolSpec {
    pub fn from_wire(wire: ToolWire) -> Result<Self, String> {
        Ok(Self {
            parameters: trim_parameters(wire.input_parameters)?,
            annotations: annotations_from_tags(&wire.tags),
            slug: wire.slug,
            description: wire.description,
            version: wire.version,
        })
    }

    pub fn into_tool(self, client: ComposioClient) -> AppResult<DynamicTool> {
        let name = ToolName::new(self.slug.clone())
            .map_err(|_| AppError::Connector("a connector tool has an empty name".to_string()))?;
        let slug = self.slug;
        let version = self.version;
        let tool = DynamicTool::new(name, self.description, self.parameters, move |arguments| {
            let client = client.clone();
            let slug = slug.clone();
            let version = version.clone();
            Box::pin(async move {
                let outcome = client
                    .execute(&slug, &version, arguments)
                    .await
                    .map_err(execution_error)?;
                if !outcome.successful {
                    return Err(ToolExecutionError::provider(
                        outcome
                            .error
                            .unwrap_or_else(|| "the connector action failed without an error message".to_string()),
                    ));
                }
                Ok(ToolOutput::json(outcome.data))
            })
        });
        Ok(tool.with_annotations(self.annotations))
    }
}

pub fn execution_error(error: ComposioError) -> ToolExecutionError {
    match error {
        ComposioError::NoToken => ToolExecutionError::permission_denied(error.to_string()),
        ComposioError::Rejected { code, .. } if code.as_deref() == Some(ACCOUNT_NOT_FOUND_CODE) => {
            ToolExecutionError::permission_denied(
                "This service is not connected. Ask the user to connect it in Integrations.",
            )
        }
        ComposioError::Rejected { status, message, .. } => match status {
            400 | 422 => ToolExecutionError::invalid_args(message),
            404 => ToolExecutionError::not_found(message),
            408 => ToolExecutionError::timeout(message),
            429 => ToolExecutionError::rate_limited(message),
            _ => ToolExecutionError::provider(message),
        },
        ComposioError::Transport(message) => ToolExecutionError::network(message),
        ComposioError::Malformed(message) => ToolExecutionError::provider(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rig::tool::ToolErrorKind;
    use serde_json::json;

    fn rejected(status: u16, code: Option<&str>) -> ComposioError {
        ComposioError::Rejected {
            status,
            code: code.map(str::to_string),
            message: "detail".to_string(),
        }
    }

    #[test]
    fn classifies_gateway_failures() {
        assert_eq!(execution_error(rejected(400, None)).kind(), ToolErrorKind::InvalidArgs);
        assert_eq!(execution_error(rejected(422, None)).kind(), ToolErrorKind::InvalidArgs);
        assert_eq!(execution_error(rejected(404, None)).kind(), ToolErrorKind::NotFound);
        assert_eq!(execution_error(rejected(408, None)).kind(), ToolErrorKind::Timeout);
        assert_eq!(execution_error(rejected(429, None)).kind(), ToolErrorKind::RateLimited);
        assert_eq!(execution_error(rejected(502, None)).kind(), ToolErrorKind::Provider);
        assert_eq!(
            execution_error(ComposioError::Transport("down".to_string())).kind(),
            ToolErrorKind::Network
        );
    }

    #[test]
    fn a_missing_account_asks_the_user_to_connect_without_leaking_ids() {
        let error = execution_error(rejected(404, Some(ACCOUNT_NOT_FOUND_CODE)));
        assert_eq!(error.kind(), ToolErrorKind::PermissionDenied);
        assert!(!error.message().contains("detail"));
    }

    #[test]
    fn builds_a_dynamic_tool_with_trimmed_schema_and_annotations() {
        let wire = ToolWire {
            slug: "GITHUB_GET_A_PULL_REQUEST".to_string(),
            description: "Reads a pull request".to_string(),
            version: "20261023_00".to_string(),
            is_deprecated: false,
            tags: vec!["readOnlyHint".to_string()],
            input_parameters: json!({
                "type": "object",
                "title": "Request",
                "required": ["owner"],
                "properties": { "owner": { "type": "string", "title": "Owner", "examples": ["a"] } }
            }),
        };
        let spec = ToolSpec::from_wire(wire).unwrap();
        assert_eq!(
            spec.parameters,
            json!({ "type": "object", "required": ["owner"], "properties": { "owner": { "type": "string" } } })
        );
        let tool = spec
            .into_tool(ComposioClient::new(std::sync::Arc::new(std::sync::RwLock::new(None))))
            .unwrap();
        assert_eq!(tool.name().to_string(), "GITHUB_GET_A_PULL_REQUEST");
        assert!(tool.definition().annotations.read_only());
    }
}
