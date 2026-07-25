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
    #[error("no pending browser content request")]
    NoBrowserRequest,
    #[error("file too large to process: {0}")]
    FileTooLarge(String),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn other(msg: impl Into<String>) -> Self {
        AppError::Other(msg.into())
    }
}

pub type AppResult<T> = Result<T, AppError>;
