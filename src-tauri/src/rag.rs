use anyhow::Result;
use ignore::WalkBuilder;
use rig::{client::EmbeddingsClient, embeddings::EmbeddingModel, providers::openai};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::{path::Path, time::UNIX_EPOCH};
use uuid::Uuid;
use crate::workspace::IGNORED_DIRS;

const EMBED_MODEL: &str = "nvidia/nv-embedqa-e5-v5";
const CHUNK_LINES: usize = 80;
const CHUNK_OVERLAP: usize = 15;
const MAX_FILE_BYTES: u64 = 512 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RagResult { pub file_path: String, pub chunk_text: String, pub score: f32 }

fn make_embed_model(token: &str) -> Result<openai::EmbeddingModel> {
    let base = format!("{}/nvidia/v1", crate::utils::gcp_base().trim_end_matches('/'));
    Ok(openai::Client::builder().api_key(token).base_url(&base).build()
        .map_err(|e| anyhow::anyhow!("{e}"))?.embedding_model(EMBED_MODEL))
}

fn cosine(a: &[f64], b: &[f64]) -> f64 {
    let dot: f64 = a.iter().zip(b).map(|(x,y)| x*y).sum();
    let na = a.iter().map(|x| x*x).sum::<f64>().sqrt();
    let nb = b.iter().map(|x| x*x).sum::<f64>().sqrt();
    if na == 0.0 || nb == 0.0 { 0.0 } else { dot / (na * nb) }
}

fn chunk_text(text: &str) -> Vec<String> {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= CHUNK_LINES { return vec![text.to_string()]; }
    let mut chunks = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let end = (i + CHUNK_LINES).min(lines.len());
        chunks.push(lines[i..end].join("\n"));
        if end == lines.len() { break; }
        i += CHUNK_LINES - CHUNK_OVERLAP;
    }
    chunks
}
fn is_ignored(path: &Path) -> bool {
    path.components().any(|c| { let s = c.as_os_str().to_string_lossy(); IGNORED_DIRS.iter().any(|ig| s == *ig) })
}
fn file_mtime(path: &Path) -> u64 {
    std::fs::metadata(path).and_then(|m| m.modified())
        .map(|t| t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
        .unwrap_or(0)
}

/// Semantic search: embeds `query`, computes cosine against stored chunks, returns top `limit`.
pub async fn search(pool: &SqlitePool, workspace_id: &str, query: &str, limit: usize) -> Result<Vec<RagResult>> {
    let token = crate::auth::require_token_async().await?;
    let model = make_embed_model(&token)?;
    let q_emb = model.embed_text(query).await?;
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT file_path, chunk_text, embedding FROM rag_chunks WHERE workspace_id=?"
    ).bind(workspace_id).fetch_all(pool).await?;
    let mut scored: Vec<(f32, String, String)> = rows.into_iter().filter_map(|(fp, ct, emb_json)| {
        let emb: Vec<f64> = serde_json::from_str(&emb_json).ok()?;
        Some((cosine(&q_emb.vec, &emb) as f32, fp, ct))
    }).collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);
    Ok(scored.into_iter().map(|(score, file_path, chunk_text)| RagResult { file_path, chunk_text, score }).collect())
}

pub async fn index_workspace(pool: &SqlitePool, workspace_id: &str, workspace_path: &str) -> Result<usize> {
    let token = crate::auth::require_token_async().await?;
    let model = make_embed_model(&token)?;
    let root = Path::new(workspace_path);
    let files: Vec<_> = WalkBuilder::new(root)
        .hidden(false).ignore(true).git_ignore(true).git_global(false).max_depth(Some(10))
        .build().flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter(|e| !is_ignored(e.path()))
        .filter(|e| e.metadata().map(|m| m.len() < MAX_FILE_BYTES).unwrap_or(false))
        .collect();
    let mut indexed = 0usize;
    for entry in files {
        let path = entry.path();
        let path_str = path.to_string_lossy().replace('\\', "/");
        let mtime = file_mtime(path);
        let existing: Option<i64> = sqlx::query_scalar(
            "SELECT file_mtime FROM rag_chunks WHERE workspace_id=? AND file_path=? LIMIT 1"
        ).bind(workspace_id).bind(&path_str).fetch_optional(pool).await?;
        if existing.map(|m| m as u64) == Some(mtime) { continue; }
        let Ok(content) = tokio::fs::read_to_string(path).await else { continue };
        if content.trim().is_empty() { continue; }
        sqlx::query("DELETE FROM rag_chunks WHERE workspace_id=? AND file_path=?")
            .bind(workspace_id).bind(&path_str).execute(pool).await?;
        let chunks = chunk_text(&content);
        let Ok(embeddings) = model.embed_texts(chunks.clone()).await else { continue };
        for (i, (chunk, emb)) in chunks.into_iter().zip(embeddings).enumerate() {
            sqlx::query("INSERT INTO rag_chunks (id,workspace_id,file_path,chunk_index,chunk_text,embedding,file_mtime) VALUES (?,?,?,?,?,?,?)")
                .bind(Uuid::new_v4().to_string()).bind(workspace_id).bind(&path_str)
                .bind(i as i64).bind(&chunk).bind(serde_json::to_string(&emb.vec)?).bind(mtime as i64)
                .execute(pool).await?;
        }
        indexed += 1;
    }
    Ok(indexed)
}
