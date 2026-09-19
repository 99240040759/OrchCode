use super::request_json;

use std::collections::HashMap;
use std::sync::Arc;

use rig::tool::Tool;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

use crate::connectors::ConnectorManager;
use crate::persistence::SqliteMemory;
use crate::tools::ToolError;

const SLACK_API: &str = "https://slack.com/api";

async fn resolve_user_names(
    manager: &ConnectorManager,
    token: &str,
    user_ids: &[String],
) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for id in user_ids {
        if id.is_empty() || id == "unknown" {
            continue;
        }
        let url = format!("{SLACK_API}/users.info?user={id}");
        if let Ok(json) = request_json(
            manager.http().get(&url).bearer_auth(token),
            "Slack",
        )
        .await
        {
            if json["ok"].as_bool().unwrap_or(false) {
                let display_name = json["user"]["profile"]["display_name"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .or_else(|| json["user"]["real_name"].as_str())
                    .or_else(|| json["user"]["name"].as_str())
                    .unwrap_or(id)
                    .to_string();
                map.insert(id.clone(), display_name);
            }
        }
    }
    map
}

fn format_ts(ts: &str) -> String {
    if let Some((secs, _)) = ts.split_once('.') {
        if let Ok(s) = secs.parse::<i64>() {
            let dt = chrono_format(s);
            return dt;
        }
    }
    ts.to_string()
}

fn chrono_format(unix_secs: i64) -> String {
    let hours = (unix_secs % 86400) / 3600;
    let minutes = (unix_secs % 3600) / 60;
    let days = unix_secs / 86400;
    let epoch_days = days + 719468;
    let era = (if epoch_days >= 0 { epoch_days } else { epoch_days - 146096 }) / 146097;
    let doe = epoch_days - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02} {hours:02}:{minutes:02}")
}

#[derive(Clone)]
pub struct SlackListChannels {
    pub manager: Arc<ConnectorManager>,
    pub memory: SqliteMemory,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SlackListChannelsArgs {
    pub max_results: Option<u32>,
    pub cursor: Option<String>,
    pub include_private: Option<bool>,
}

impl Tool for SlackListChannels {
    const NAME: &'static str = "slack_list_channels";
    type Args = SlackListChannelsArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "List Slack channels in the workspace. Supports pagination via cursor. Set include_private=true to include private channels the bot has access to.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("slack", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Slack auth: {e}")))?;

        let limit = args.max_results.unwrap_or(100).min(1000);
        let channel_types = if args.include_private.unwrap_or(false) {
            "public_channel,private_channel"
        } else {
            "public_channel"
        };
        let mut url = format!(
            "{SLACK_API}/conversations.list?limit={limit}&exclude_archived=true&types={channel_types}"
        );
        if let Some(cursor) = &args.cursor {
            url.push_str(&format!("&cursor={}", urlencoding::encode(cursor)));
        }

        let json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Slack",
        )
        .await?;

        check_slack_errors(&json)?;

        let channels = json["channels"].as_array().cloned().unwrap_or_default();
        let next_cursor = json["response_metadata"]["next_cursor"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        if channels.is_empty() {
            return Ok("No channels found.".to_string());
        }

        let mut out = format!("Found {} channel(s):\n\n", channels.len());
        for ch in &channels {
            let name = ch["name"].as_str().unwrap_or("(unnamed)");
            let id = ch["id"].as_str().unwrap_or("");
            let purpose = ch["purpose"]["value"].as_str().unwrap_or("");
            let topic = ch["topic"]["value"].as_str().unwrap_or("");
            let members = ch["num_members"].as_u64().unwrap_or(0);
            let private = ch["is_private"].as_bool().unwrap_or(false);
            let archived = ch["is_archived"].as_bool().unwrap_or(false);
            if archived {
                continue;
            }
            let mut desc = format!(
                "• #{name} [ID: {id}] {}\n  Members: {members}\n",
                if private { "(private)" } else { "(public)" }
            );
            if !topic.is_empty() {
                desc.push_str(&format!("  Topic: {topic}\n"));
            }
            if !purpose.is_empty() && purpose != topic {
                desc.push_str(&format!("  Purpose: {purpose}\n"));
            }
            out.push_str(&desc);
            out.push('\n');
        }

        if let Some(cursor) = next_cursor {
            out.push_str(&format!("\n[More channels — use cursor: \"{cursor}\" to fetch next page]"));
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
    pub cursor: Option<String>,
}

impl Tool for SlackReadMessages {
    const NAME: &'static str = "slack_read_messages";
    type Args = SlackReadMessagesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Read recent messages from a Slack channel by channel ID. Resolves user IDs to display names. Supports pagination via cursor.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("slack", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Slack auth: {e}")))?;

        let limit = args.limit.unwrap_or(50).min(200);
        let mut url = format!(
            "{SLACK_API}/conversations.history?channel={}&limit={limit}",
            urlencoding::encode(&args.channel_id)
        );
        if let Some(oldest) = args.oldest {
            url.push_str(&format!("&oldest={oldest}"));
        }
        if let Some(cursor) = &args.cursor {
            url.push_str(&format!("&cursor={}", urlencoding::encode(cursor)));
        }

        let json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Slack",
        )
        .await?;

        check_slack_errors(&json)?;

        let messages = json["messages"].as_array().cloned().unwrap_or_default();
        let next_cursor = json["response_metadata"]["next_cursor"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        if messages.is_empty() {
            return Ok("No messages found.".to_string());
        }

        let user_ids: Vec<String> = messages
            .iter()
            .filter_map(|m| m["user"].as_str())
            .filter(|u| !u.is_empty())
            .map(|u| u.to_string())
            .collect::<std::collections::HashSet<String>>()
            .into_iter()
            .collect();

        let user_map = resolve_user_names(&self.manager, &token, &user_ids).await;

        let mut out = format!("Channel {} — {} message(s):\n\n", args.channel_id, messages.len());
        for msg in messages.iter().rev() {
            let user_id = msg["user"].as_str().unwrap_or("unknown");
            let display_name = user_map.get(user_id).map(|s| s.as_str()).unwrap_or(user_id);
            let ts = msg["ts"].as_str().unwrap_or("—");
            let formatted_ts = format_ts(ts);
            let text = msg["text"].as_str().unwrap_or("(no text)");
            let subtype = msg["subtype"].as_str().unwrap_or("");

            if subtype == "channel_join" || subtype == "channel_leave" {
                continue;
            }

            out.push_str(&format!("[{formatted_ts}] {display_name}: {text}\n"));

            if let Some(attachments) = msg["attachments"].as_array() {
                for att in attachments {
                    if let Some(fallback) = att["fallback"].as_str() {
                        out.push_str(&format!("  [Attachment: {fallback}]\n"));
                    }
                }
            }

            if let Some(files) = msg["files"].as_array() {
                for file in files {
                    let fname = file["name"].as_str().unwrap_or("file");
                    let ftype = file["filetype"].as_str().unwrap_or("?");
                    out.push_str(&format!("  [File: {fname} ({ftype})]\n"));
                }
            }
        }

        if let Some(cursor) = next_cursor {
            out.push_str(&format!("\n[More messages — use cursor: \"{cursor}\" to fetch next page]"));
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
    pub page: Option<u32>,
}

impl Tool for SlackSearchMessages {
    const NAME: &'static str = "slack_search_messages";
    type Args = SlackSearchMessagesArgs;
    type Output = String;
    type Error = ToolError;

    fn description(&self) -> String {
        "Search messages across all Slack channels using Slack's search syntax. Supports pagination via page number.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(Self::Args)).unwrap_or_default()
    }

    async fn call(&self, _ctx: &mut rig::tool::ToolContext, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let token = self
            .manager
            .get_access_token("slack", &self.memory)
            .await
            .map_err(|e| ToolError::msg(format!("Slack auth: {e}")))?;

        let limit = args.max_results.unwrap_or(20).min(100);
        let page = args.page.unwrap_or(1).max(1);
        let url = format!(
            "{SLACK_API}/search.messages?query={}&count={limit}&page={page}&highlight=false",
            urlencoding::encode(&args.query)
        );

        let json = request_json(
            self.manager.http().get(&url).bearer_auth(&token),
            "Slack",
        )
        .await?;

        check_slack_errors(&json)?;

        let matches = json["messages"]["matches"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let total = json["messages"]["total"].as_u64().unwrap_or(0);
        let total_pages = json["messages"]["pagination"]["page_count"].as_u64().unwrap_or(1);

        if matches.is_empty() {
            return Ok(format!("No messages found for '{}'.", args.query));
        }

        let mut out = format!(
            "Found {total} total message(s) matching '{}' (page {page} of {total_pages}, showing {}):\n\n",
            args.query,
            matches.len()
        );
        for m in &matches {
            let channel = m["channel"]["name"].as_str().unwrap_or("(unknown)");
            let channel_id = m["channel"]["id"].as_str().unwrap_or("");
            let username = m["username"].as_str().unwrap_or("unknown");
            let ts = m["ts"].as_str().unwrap_or("—");
            let formatted_ts = format_ts(ts);
            let text = m["text"].as_str().unwrap_or("(no text)");
            let permalink = m["permalink"].as_str().unwrap_or("");
            out.push_str(&format!(
                "• #{channel} [{channel_id}] | {username} | {formatted_ts}\n  {text}\n  {permalink}\n\n"
            ));
        }

        if page < total_pages as u32 {
            out.push_str(&format!(
                "\n[More results — use page: {} to fetch next page]",
                page + 1
            ));
        }

        Ok(out)
    }
}

fn check_slack_errors(json: &Value) -> Result<(), ToolError> {
    if !json["ok"].as_bool().unwrap_or(false) {
        let err = json["error"].as_str().unwrap_or("unknown_error");
        let needed = json["needed"].as_str().unwrap_or("");
        let msg = if !needed.is_empty() {
            format!("Slack API error: {err} (missing scope: {needed})")
        } else {
            format!("Slack API error: {err}")
        };
        return Err(ToolError::msg(msg));
    }
    Ok(())
}
