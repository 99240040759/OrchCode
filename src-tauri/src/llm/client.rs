use rig::providers::openai;
use crate::config;
use crate::error::{AppError, AppResult};

pub type ChatClient = openai::CompletionsClient;
pub type ChatModel = openai::completion::CompletionModel<reqwest::Client>;

pub fn build_client(jwt: &str) -> AppResult<ChatClient> {
    let client = openai::Client::builder()
        .api_key(jwt)
        .base_url(&config::inference_base_url())
        .build()
        .map_err(|e| AppError::other(format!("failed to build inference client: {e:?}")))?
        .completions_api();
    Ok(client)
}
