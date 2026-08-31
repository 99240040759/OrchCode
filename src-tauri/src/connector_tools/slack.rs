use super::request_json;

use std::sync::Arc;

use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::ToolError;

const SLACK_API: &str = "https://slack.com/api";

#[derive(Clone)]
pub struct SlackListChannels {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SlackListChannelsArgs {
    pub max_results: Option<u32>,
}

impl Tool for SlackListChannels {
    const NAME: &'static str = "slack_list_channels";
    type Args = SlackListChannelsArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "List public Slack channels in the workspace.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("slack", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Slack auth: {e}")))?;

        let limit = args.max_results.unwrap_or(50).min(200);
        let url = format!(
            "{SLACK_API}/conversations.list?limit={limit}&exclude_archived=true&types=public_channel"
        );

        let json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Slack",
        )
        .await?;

        if !json["ok"].as_bool().unwrap_or(false) {
            let err = json["error"].as_str().unwrap_or("unknown error");
            return Err(ToolError::msg(format!("Slack API error: {err}")));
        }

        let channels = json["channels"].as_array().cloned().unwrap_or_default();
        if channels.is_empty() {
            return Ok("No channels found.".to_string());
        }

        let mut out = format!("Found {} channel(s):\n\n", channels.len());
        for ch in &channels {
            let name = ch["name"].as_str().unwrap_or("(unnamed)");
            let id = ch["id"].as_str().unwrap_or("");
            let purpose = ch["purpose"]["value"].as_str().unwrap_or("");
            let members = ch["num_members"].as_u64().unwrap_or(0);
            let private = ch["is_private"].as_bool().unwrap_or(false);
            out.push_str(&format!(
                "• #{name} [{id}] {}\n  Members: {members}{}\n\n",
                if private { "(private)" } else { "(public)" },
                if purpose.is_empty() {
                    String::new()
                } else {
                    format!("\n  Purpose: {purpose}")
                }
            ));
        }

        Ok(out)
    }
}

#[derive(Clone)]
pub struct SlackReadMessages {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SlackReadMessagesArgs {
    pub channel_id: String,
    pub limit: Option<u32>,
    pub oldest: Option<f64>,
}

impl Tool for SlackReadMessages {
    const NAME: &'static str = "slack_read_messages";
    type Args = SlackReadMessagesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Read recent messages from a Slack channel by channel ID.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("slack", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Slack auth: {e}")))?;

        let limit = args.limit.unwrap_or(50).min(100);
        let mut url = format!(
            "{SLACK_API}/conversations.history?channel={}&limit={limit}",
            args.channel_id
        );
        if let Some(oldest) = args.oldest {
            url.push_str(&format!("&oldest={oldest}"));
        }

        let json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Slack",
        )
        .await?;

        if !json["ok"].as_bool().unwrap_or(false) {
            let err = json["error"].as_str().unwrap_or("unknown");
            return Err(ToolError::msg(format!("Slack error: {err}")));
        }

        let messages = json["messages"].as_array().cloned().unwrap_or_default();
        if messages.is_empty() {
            return Ok("No messages found.".to_string());
        }

        let mut out = format!("Channel: {}\n\n", args.channel_id);
        for msg in messages.iter().rev() {
            let user = msg["user"].as_str().unwrap_or("unknown");
            let ts = msg["ts"].as_str().unwrap_or("—");
            let text = msg["text"].as_str().unwrap_or("(no text)");
            out.push_str(&format!("[{ts}] {user}: {text}\n"));
        }

        Ok(out)
    }
}

#[derive(Clone)]
pub struct SlackSearchMessages {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SlackSearchMessagesArgs {
    pub query: String,
    pub max_results: Option<u32>,
}

impl Tool for SlackSearchMessages {
    const NAME: &'static str = "slack_search_messages";
    type Args = SlackSearchMessagesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String { "Search messages across all Slack channels.".to_string() } fn parameters(&self) -> serde_json::Value { serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default() }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("slack", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Slack auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(100);
        let url = format!(
            "{SLACK_API}/search.messages?query={}&count={limit}",
            urlencoding::encode(&args.query)
        );

        let json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Slack",
        )
        .await?;

        if !json["ok"].as_bool().unwrap_or(false) {
            let err = json["error"].as_str().unwrap_or("unknown");
            return Err(ToolError::msg(format!("Slack search error: {err}")));
        }

        let matches = json["messages"]["matches"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let total = json["messages"]["total"].as_u64().unwrap_or(0);

        if matches.is_empty() {
            return Ok(format!("No messages found for '{}'.", args.query));
        }

        let mut out = format!(
            "Found {total} total results (showing {}):\n\n",
            matches.len()
        );
        for m in &matches {
            let channel = m["channel"]["name"].as_str().unwrap_or("(unknown)");
            let user = m["username"].as_str().unwrap_or("unknown");
            let ts = m["ts"].as_str().unwrap_or("—");
            let text = m["text"].as_str().unwrap_or("(no text)");
            let permalink = m["permalink"].as_str().unwrap_or("");
            out.push_str(&format!(
                "• #{channel} [{ts}] {user}:\n  {text}\n  {permalink}\n\n"
            ));
        }

        Ok(out)
    }
}

