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
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("audio capture error: {0}")]
    Audio(String),
    #[error("a run is already active for this session")]
    RunConflict,
    #[error("file too large to process: {0}")]
    FileTooLarge(String),
    #[error("connector not found: {0}")]
    ConnectorNotFound(String),
    #[error("connector '{0}' is not configured (missing OAuth client credentials)")]
    ConnectorNotConfigured(String),
    #[error("connector auth error: {0}")]
    ConnectorAuthError(String),
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
            AppError::Gateway { status, .. } => matches!(status, 400 | 401 | 403),
            _ => false,
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
