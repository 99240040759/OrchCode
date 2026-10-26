use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rig::tool::DynamicTool;

use crate::connector_tools::actions::{self, ActionDef};
use crate::connector_tools::client::{AccountWire, ComposioClient};
use crate::connector_tools::tool::ToolSpec;
use crate::error::{AppError, AppResult};
use crate::gateway::TokenHandle;

const ACTIVE_STATUS: &str = "ACTIVE";
const DEFINITIONS_TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Debug)]
pub struct ConnectorDef {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub category: &'static str,
    pub slug_prefix: &'static str,
    pub actions: &'static [ActionDef],
}

pub static CONNECTOR_DEFS: &[ConnectorDef] = &[
    ConnectorDef {
        id: "googledrive",
        name: "Google Drive",
        description: "Search, read, and organize files, folders, and spreadsheets in Google Drive.",
        category: "Cloud Storage",
        slug_prefix: "GOOGLEDRIVE_",
        actions: actions::GOOGLEDRIVE,
    },
    ConnectorDef {
        id: "gmail",
        name: "Gmail",
        description: "Search and read email, and create, send, and reply to messages in Gmail.",
        category: "Communication",
        slug_prefix: "GMAIL_",
        actions: actions::GMAIL,
    },
    ConnectorDef {
        id: "github",
        name: "GitHub",
        description: "Browse repositories and code, manage issues and pull requests, and commit changes.",
        category: "Dev Tools",
        slug_prefix: "GITHUB_",
        actions: actions::GITHUB,
    },
    ConnectorDef {
        id: "notion",
        name: "Notion",
        description: "Search, read, and edit pages and databases in Notion workspaces.",
        category: "Productivity",
        slug_prefix: "NOTION_",
        actions: actions::NOTION,
    },
    ConnectorDef {
        id: "slack",
        name: "Slack",
        description: "Search and read channel history, and send and schedule messages in Slack.",
        category: "Communication",
        slug_prefix: "SLACK_",
        actions: actions::SLACK,
    },
    ConnectorDef {
        id: "jira",
        name: "Jira",
        description: "Search, create, and update issues, comments, and workflow transitions in Jira Cloud.",
        category: "Dev Tools",
        slug_prefix: "JIRA_",
        actions: actions::JIRA,
    },
];

pub fn find_def(id: &str) -> Option<&'static ConnectorDef> {
    CONNECTOR_DEFS.iter().find(|def| def.id == id)
}

pub fn resolve_defs(ids: &[String]) -> AppResult<Vec<&'static ConnectorDef>> {
    for id in ids {
        find_def(id).ok_or_else(|| AppError::ConnectorNotFound(id.clone()))?;
    }
    Ok(CONNECTOR_DEFS
        .iter()
        .filter(|def| ids.iter().any(|id| id == def.id))
        .collect())
}

pub fn def_for_slug(slug: &str) -> Option<&'static ConnectorDef> {
    CONNECTOR_DEFS.iter().find(|def| slug.starts_with(def.slug_prefix))
}

struct CachedSpecs {
    fetched: Instant,
    specs: Arc<Vec<ToolSpec>>,
}

pub struct PreparedConnectors {
    pub tools: Vec<DynamicTool>,
    pub defs: Vec<&'static ConnectorDef>,
}

pub struct ConnectorManager {
    client: ComposioClient,
    cache: Mutex<HashMap<&'static str, CachedSpecs>>,
}

impl ConnectorManager {
    pub fn new(token: TokenHandle) -> Self {
        Self {
            client: ComposioClient::new(token),
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub async fn connected_ids(&self) -> AppResult<Vec<&'static str>> {
        let accounts = self.client.accounts().await?;
        Ok(CONNECTOR_DEFS
            .iter()
            .filter(|def| is_connected(&accounts, def))
            .map(|def| def.id)
            .collect())
    }

    pub async fn begin_connect(&self, id: &str) -> AppResult<String> {
        let def = find_def(id).ok_or_else(|| AppError::ConnectorNotFound(id.to_string()))?;
        Ok(self.client.connect(def.id).await?)
    }

    pub async fn disconnect(&self, id: &str) -> AppResult<()> {
        let def = find_def(id).ok_or_else(|| AppError::ConnectorNotFound(id.to_string()))?;
        let accounts = self.client.accounts().await?;
        let account = accounts
            .iter()
            .find(|account| account.toolkit == def.id && account.status == ACTIVE_STATUS)
            .ok_or_else(|| AppError::ConnectorNotConnected(def.name.to_string()))?;
        Ok(self.client.disconnect(&account.id).await?)
    }

    pub async fn prepare(&self, ids: &[String]) -> AppResult<PreparedConnectors> {
        let defs = resolve_defs(ids)?;
        if defs.is_empty() {
            return Ok(PreparedConnectors { tools: Vec::new(), defs });
        }

        let accounts = self.client.accounts().await?;
        if let Some(missing) = defs.iter().find(|def| !is_connected(&accounts, def)) {
            return Err(AppError::ConnectorNotConnected(missing.name.to_string()));
        }

        let sets = futures::future::try_join_all(defs.iter().map(|def| self.specs(def))).await?;
        let mut tools = Vec::new();
        for set in sets {
            for spec in set.iter() {
                tools.push(spec.clone().into_tool(self.client.clone())?);
            }
        }
        Ok(PreparedConnectors { tools, defs })
    }

    fn cached(&self, id: &'static str) -> Option<Arc<Vec<ToolSpec>>> {
        let cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache
            .get(id)
            .filter(|entry| entry.fetched.elapsed() < DEFINITIONS_TTL)
            .map(|entry| entry.specs.clone())
    }

    async fn specs(&self, def: &'static ConnectorDef) -> AppResult<Arc<Vec<ToolSpec>>> {
        if let Some(hit) = self.cached(def.id) {
            return Ok(hit);
        }
        let slugs: Vec<&str> = def.actions.iter().map(|action| action.slug).collect();
        let wires = self.client.tools(&slugs).await?;
        let mut specs = Vec::with_capacity(slugs.len());
        for action in def.actions {
            let Some(wire) = wires.iter().find(|wire| wire.slug == action.slug) else {
                eprintln!("[connectors] {} is not in the connector catalog and was skipped", action.slug);
                continue;
            };
            if wire.is_deprecated {
                eprintln!("[connectors] {} is deprecated and was skipped", action.slug);
                continue;
            }
            let spec = ToolSpec::from_wire(wire.clone())
                .map_err(|reason| AppError::Connector(format!("{}: {reason}", action.slug)))?;
            specs.push(spec);
        }
        if specs.is_empty() {
            let err = AppError::Connector(format!("No tools are available for {}", def.name));
            sentry::capture_error(&err);
            return Err(err);
        }
        let specs = Arc::new(specs);
        self.cache.lock().unwrap_or_else(|e| e.into_inner()).insert(
            def.id,
            CachedSpecs {
                fetched: Instant::now(),
                specs: specs.clone(),
            },
        );
        Ok(specs)
    }
}

fn is_connected(accounts: &[AccountWire], def: &ConnectorDef) -> bool {
    accounts
        .iter()
        .any(|account| account.toolkit == def.id && account.status == ACTIVE_STATUS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn connector_ids_are_unique() {
        let ids: HashSet<&str> = CONNECTOR_DEFS.iter().map(|def| def.id).collect();
        assert_eq!(ids.len(), CONNECTOR_DEFS.len());
    }

    #[test]
    fn every_action_slug_belongs_to_its_connector_and_is_unique() {
        let mut seen = HashSet::new();
        for def in CONNECTOR_DEFS {
            assert_eq!(def.slug_prefix, format!("{}_", def.id.to_uppercase()));
            assert!(!def.actions.is_empty());
            for action in def.actions {
                assert!(action.slug.starts_with(def.slug_prefix), "{}", action.slug);
                assert!(action.slug.len() <= 64, "{}", action.slug);
                assert!(seen.insert(action.slug), "duplicate {}", action.slug);
                assert!(!action.label.is_empty());
            }
        }
    }

    #[test]
    fn slugs_resolve_to_their_connector() {
        assert_eq!(def_for_slug("GOOGLEDRIVE_FIND_FILE").map(|d| d.id), Some("googledrive"));
        assert_eq!(def_for_slug("JIRA_GET_ISSUE").map(|d| d.id), Some("jira"));
        assert!(def_for_slug("read_file").is_none());
    }

    #[test]
    fn allowlist_holds_the_curated_tool_count() {
        let total: usize = CONNECTOR_DEFS.iter().map(|def| def.actions.len()).sum();
        assert_eq!(total, 67);
    }

    #[test]
    fn resolved_connectors_follow_canonical_order_whatever_the_selection_order() {
        let ids = |list: &[&str]| list.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        let forward: Vec<_> = resolve_defs(&ids(&["github", "slack", "gmail"])).unwrap().iter().map(|d| d.id).collect();
        let reverse: Vec<_> = resolve_defs(&ids(&["gmail", "slack", "github", "slack"])).unwrap().iter().map(|d| d.id).collect();
        assert_eq!(forward, vec!["gmail", "github", "slack"]);
        assert_eq!(forward, reverse);
        assert!(resolve_defs(&ids(&["github", "nope"])).is_err());
        assert!(resolve_defs(&[]).unwrap().is_empty());
    }
}
