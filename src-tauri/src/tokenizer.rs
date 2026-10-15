use rig::completion::Message;
use rig::message::{AssistantContent, ToolResult, ToolResultContent, UserContent};
use tiktoken_rs::cl100k_base_singleton;

pub fn count_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    let bpe = cl100k_base_singleton();
    bpe.encode_with_special_tokens(text).len()
}

pub fn count_image_tokens(width: u32, height: u32) -> usize {
    if width == 0 || height == 0 {
        return 85;
    }
    let tiles_x = (width + 511) / 512;
    let tiles_y = (height + 511) / 512;
    85 + (tiles_x as usize) * (tiles_y as usize) * 170
}

pub fn count_tool_result_tokens(tr: &ToolResult) -> usize {
    let mut total = count_tokens(&tr.id);
    if let Some(call_id) = &tr.call_id {
        total += count_tokens(call_id);
    }
    for item in tr.content.iter() {
        match item {
            ToolResultContent::Text(t) => total += count_tokens(&t.text),
            ToolResultContent::Json { value } => total += count_tokens(&value.to_string()),
            ToolResultContent::Image(_) => total += 1_000,
        }
    }
    total
}

pub fn count_message_tokens(message: &Message) -> usize {
    let mut total = 3;
    match message {
        Message::User { content } => {
            for part in content.iter() {
                match part {
                    UserContent::Text(t) => total += count_tokens(&t.text),
                    UserContent::ToolResult(tr) => total += count_tool_result_tokens(tr),
                    UserContent::Image(_) => total += 1_000,
                    _ => total += 50,
                }
            }
        }
        Message::Assistant { content, .. } => {
            for part in content.iter() {
                match part {
                    AssistantContent::Text(t) => total += count_tokens(&t.text),
                    AssistantContent::ToolCall(tc) => {
                        total += count_tokens(&tc.function.name);
                        total += count_tokens(&tc.function.arguments.to_string());
                        total += 8;
                    }
                    AssistantContent::Reasoning(r) => total += count_tokens(&r.display_text()),
                    _ => {}
                }
            }
        }
        _ => total += 10,
    }
    total
}

pub fn count_messages_tokens(messages: &[Message]) -> usize {
    messages.iter().map(count_message_tokens).sum()
}
