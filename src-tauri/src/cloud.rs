use serde::{Deserialize, Serialize};

pub const CLOUD_WORKSPACE_PREFIX: &str = "cloud://";

pub fn is_cloud_workspace(workspace: &str) -> bool {
    workspace.trim().starts_with(CLOUD_WORKSPACE_PREFIX)
}

pub fn normalize_cloud_workspace_and_repo(input: &str) -> Result<(String, String), String> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Repository URL cannot be empty.".to_string());
    }

    let without_scheme = if let Some(rest) = trimmed.strip_prefix(CLOUD_WORKSPACE_PREFIX) {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("https://") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        rest
    } else if !trimmed.contains("://") {
        trimmed
    } else {
        return Err(
            "Only public HTTP/HTTPS Git repository URLs (e.g. https://github.com/owner/repo) are supported."
                .to_string(),
        );
    };

    let clean = without_scheme
        .trim_start_matches('/')
        .trim_end_matches('/')
        .trim_end_matches(".git");

    let parts: Vec<&str> = clean.split('/').filter(|s| !s.is_empty()).collect();
    let (host, owner, repo) = match parts.as_slice() {
        [owner, repo] if !owner.contains('.') => ("github.com", *owner, *repo),
        [host, owner, repo, ..] if host.contains('.') => (*host, *owner, *repo),
        _ => {
            return Err(
                "Invalid repository URL. Expected https://github.com/<owner>/<repo> (or <owner>/<repo>)."
                    .to_string(),
            );
        }
    };

    if owner.is_empty() || repo.is_empty() {
        return Err("Repository owner and name must not be empty.".to_string());
    }

    let canonical_path = format!("{host}/{owner}/{repo}");
    let workspace_uri = format!("{CLOUD_WORKSPACE_PREFIX}{canonical_path}");
    let repo_url = format!("https://{canonical_path}.git");
    Ok((workspace_uri, repo_url))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudWorkspaceInfo {
    pub workspace: String,
    pub repo_url: String,
    pub repo_dir: String,
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
