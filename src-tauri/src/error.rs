use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("not authenticated: no access token set")]
    NoToken,
    #[error("no workspace folder set")]
    NoWorkspace,
    #[error("path escapes the workspace root: {0}")]
    PathEscapesWorkspace(String),
    #[error("gateway request failed ({status}): {body}")]
    Gateway { status: u16, body: String },
    #[error("network error: {0}")]
    Network(String),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("audio capture error: {0}")]
    Audio(String),
    #[error("a run is already active for this session")]
    RunConflict,
    #[error("connector not found: {0}")]
    ConnectorNotFound(String),
    #[error("{0} is not connected. Connect it in Integrations and try again.")]
    ConnectorNotConnected(String),
    #[error("{0}")]
    Connector(String),
    #[error("document parse error: {0}")]
    DocumentParseError(String),
    #[error("unsupported file type: {0}")]
    UnsupportedFileType(String),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn other(msg: impl Into<String>) -> Self {
        AppError::Other(msg.into())
    }

    pub fn is_fatal_auth(&self) -> bool {
        match self {
            AppError::NoToken => true,
            AppError::Gateway { status, body } => {
                matches!(status, 401 | 403)
                    || (*status == 400
                        && [
                            "INVALID_REFRESH_TOKEN",
                            "TOKEN_EXPIRED",
                            "USER_DISABLED",
                            "USER_NOT_FOUND",
                        ]
                        .iter()
                        .any(|code| body.contains(*code)))
            }
            _ => false,
        }
    }

    pub fn is_transient(&self) -> bool {
        match self {
            AppError::Network(_) | AppError::Http(_) => true,
            AppError::Gateway { status, .. } => *status == 429 || *status >= 500,
            _ => false,
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<reqwest_middleware::Error> for AppError {
    fn from(error: reqwest_middleware::Error) -> Self {
        AppError::Network(error.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
