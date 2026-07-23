use std::sync::Arc;
use schemars::JsonSchema;
use serde::Deserialize;
use rig::tool::Tool;
use super::ToolError;
use crate::gateway::{Gateway, TavilyRequest};

#[derive(Deserialize, JsonSchema)]
pub struct WebSearchArgs {
    pub query: String,
    #[serde(default)]
    pub max_results: Option<u32>,
    #[serde(default)]
    pub search_depth: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
}

pub struct WebSearch {
    gateway: Arc<Gateway>,
}

impl WebSearch {
    pub fn new(gateway: Arc<Gateway>) -> Self {
        Self { gateway }
    }
}

impl Tool for WebSearch {
    const NAME: &'static str = "web_search";
    type Error = ToolError;
    type Args = WebSearchArgs;
    type Output = String;

    fn description(&self) -> String {
        "Search the web for current information. Use this for anything that may be newer than your training data, for library/API documentation, or to verify facts. Optionally pass search_depth ('basic' or 'advanced') and domain. Returns a list of results with titles, URLs, and snippets.".to_string()
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::to_value(schemars::schema_for!(WebSearchArgs)).unwrap_or_default()
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let depth = args.search_depth.unwrap_or_else(|| "basic".to_string());
        let req = TavilyRequest {
            query: args.query.clone(),
            max_results: Some(args.max_results.unwrap_or(5).clamp(1, 10)),
            search_depth: Some(depth),
            topic: args.topic,
            domain: args.domain,
        };

        let resp = self.gateway.tavily(&req).await?;
        let mut out = String::new();
        if let Some(answer) = resp.answer.filter(|a| !a.is_empty()) {
            out.push_str("Answer: ");
            out.push_str(&answer);
            out.push_str("\n\n");
        }

        if resp.results.is_empty() {
            out.push_str("No results found.");
            return Ok(out);
        }

        for (i, r) in resp.results.iter().enumerate() {
            let snippet: String = r.content.chars().take(500).collect();
            out.push_str(&format!(
                "{}. {}\n   {}\n   {}\n",
                i + 1,
                if r.title.is_empty() { "(untitled)" } else { &r.title },
                r.url,
                snippet
            ));
        }

        Ok(out)
    }
}
