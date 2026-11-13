pub use orchharness::persistence::CloudWorkspaceInfo;

pub const CLOUD_WORKSPACE_PREFIX: &str = "cloud://";

pub fn is_cloud_workspace(workspace: &str) -> bool {
    workspace.trim().starts_with(CLOUD_WORKSPACE_PREFIX)
}

pub fn absolute_cloud_path(repo_dir: &str, path: &str) -> String {
    let trimmed = path.trim();
    let stripped = trimmed.strip_prefix("file://").unwrap_or(trimmed);
    if stripped.starts_with('/') {
        stripped.to_string()
    } else {
        format!(
            "{}/{}",
            repo_dir.trim_end_matches('/'),
            stripped.trim_start_matches("./")
        )
    }
}

pub fn relative_cloud_path(repo_dir: &str, path: &str) -> Option<String> {
    let prefix = format!("{}/", repo_dir.trim_end_matches('/'));
    path.strip_prefix(&prefix).map(str::to_string)
}

#[derive(Debug, Clone)]
pub struct CloudWorkspace {
    pub workspace_uri: String,
    pub repo_url: String,
    pub repo_dir: String,
}

impl CloudWorkspace {
    pub fn from_info(info: CloudWorkspaceInfo) -> Self {
        Self {
            workspace_uri: info.workspace,
            repo_url: info.repo_url,
            repo_dir: info.repo_dir,
        }
    }
}
