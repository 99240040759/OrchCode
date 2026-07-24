use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use rig::client::EmbeddingsClient;
use rig::Embed;
use rig::embeddings::{Embedding, EmbeddingsBuilder, EmbedError, TextEmbedder};
use rig::providers::openai;
use rig::vector_store::in_memory_store::InMemoryVectorStore;
use rig::vector_store::request::VectorSearchRequest;
use rig::vector_store::{VectorStoreError, VectorStoreIndex};
use rig::OneOrMany;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::config;
use crate::gateway::TokenHandle;

const CHUNK_LINES: usize = 40;
const CHUNK_OVERLAP: usize = 8;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const EMBEDDING_MODEL: &str = "gemini-embedding-2";
const EMBEDDING_NDIMS: usize = 3072;

const SKIP_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico",
    "pdf", "zip", "tar", "gz", "7z", "rar",
    "exe", "dll", "so", "dylib", "bin", "wasm",
    "lock", "sum", "ttf", "otf", "woff", "woff2",
    "mp3", "mp4", "mov", "wav", "ogg",
];

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build", ".next",
    ".turbo", "coverage", "__pycache__", ".venv", "venv",
    ".idea", ".vscode",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodeChunk {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
}

impl Embed for CodeChunk {
    fn embed(&self, embedder: &mut TextEmbedder) -> Result<(), EmbedError> {
        embedder.embed(format!(
            "file: {}\nlines: {}-{}\n\n{}",
            self.file_path, self.start_line, self.end_line, self.content
        ));
        Ok(())
    }
}

pub type OaiEmbeddingModel = openai::EmbeddingModel;

struct IndexState {
    store: InMemoryVectorStore<CodeChunk>,
    workspace: PathBuf,
}

#[derive(Clone)]
pub struct WorkspaceIndex {
    inner: Arc<RwLock<Option<IndexState>>>,
    conn: Arc<Mutex<Connection>>,
    token: TokenHandle,
}

impl WorkspaceIndex {
    pub fn new(conn: Arc<Mutex<Connection>>, token: TokenHandle) -> Self {
        Self {
            inner: Arc::new(RwLock::new(None)),
            conn,
            token,
        }
    }

    fn build_model(&self) -> Option<OaiEmbeddingModel> {
        let jwt = self.token.read().ok().and_then(|g| g.clone())?;
        let client = openai::Client::builder()
            .api_key(jwt)
            .base_url(config::gcp_functions_url())
            .build()
            .ok()?;
        Some(client.embedding_model_with_ndims(EMBEDDING_MODEL, EMBEDDING_NDIMS))
    }

    pub fn is_empty_for(&self, workspace: &Path) -> bool {
        self.inner
            .read()
            .ok()
            .and_then(|g| g.as_ref().map(|s| s.workspace != workspace || s.store.is_empty()))
            .unwrap_or(true)
    }

    pub fn chunk_count(&self) -> usize {
        self.inner
            .read()
            .ok()
            .and_then(|g| g.as_ref().map(|s| s.store.len()))
            .unwrap_or(0)
    }

    pub async fn ensure_indexed(&self, workspace: &Path) -> Result<(), VectorStoreError> {
        if !self.is_empty_for(workspace) {
            return Ok(());
        }

        if let Err(e) = self.load_from_db(workspace) {
            eprintln!("[vector_store] db load failed: {e}");
        }

        if !self.is_empty_for(workspace) {
            self.sync_stale_files(workspace).await?;
            return Ok(());
        }

        self.index_workspace(workspace).await?;
        Ok(())
    }

    fn load_from_db(&self, workspace: &Path) -> Result<(), rusqlite::Error> {
        let ws_str = workspace.to_string_lossy().to_string();
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let mut stmt = conn.prepare(
            "SELECT id, file_path, start_line, end_line, content, embedding
             FROM vector_chunks WHERE workspace = ?1",
        )?;

        let rows = stmt.query_map(params![ws_str], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? as usize,
                row.get::<_, i64>(3)? as usize,
                row.get::<_, String>(4)?,
                row.get::<_, Vec<u8>>(5)?,
            ))
        })?;

        let mut entries: Vec<(String, CodeChunk, OneOrMany<Embedding>)> = Vec::new();
        for row in rows.flatten() {
            let (id, file_path, start_line, end_line, content, blob) = row;
            let vec: Vec<f64> = blob
                .chunks_exact(8)
                .map(|b| f64::from_le_bytes(b.try_into().unwrap_or([0u8; 8])))
                .collect();
            if vec.len() < 8 {
                continue;
            }
            let chunk = CodeChunk { file_path, start_line, end_line, content: content.clone() };
            let embedding = Embedding { document: content, vec };
            entries.push((id, chunk, OneOrMany::one(embedding)));
        }

        if entries.is_empty() {
            return Ok(());
        }

        let store = InMemoryVectorStore::builder()
            .documents_with_ids(entries)
            .build();

        if let Ok(mut guard) = self.inner.write() {
            *guard = Some(IndexState { store, workspace: workspace.to_path_buf() });
        }

        Ok(())
    }

    async fn sync_stale_files(&self, workspace: &Path) -> Result<(), VectorStoreError> {
        let ws_str = workspace.to_string_lossy().to_string();
        let files = collect_files(workspace);
        let live_rels: std::collections::HashSet<String> =
            files.iter().map(|f| relative_path(workspace, f)).collect();

        let stored_hashes = self.load_hashes(&ws_str)?;

        let mut stale_files: Vec<PathBuf> = Vec::new();
        for file_path in &files {
            let rel = relative_path(workspace, file_path);
            let current_hash = file_hash(file_path);
            let stored = stored_hashes.get(&rel);
            match (current_hash, stored) {
                (Some(ch), Some(sh)) if &ch == sh => {}
                _ => stale_files.push(file_path.clone()),
            }
        }

        self.delete_removed_files(&ws_str, &live_rels)?;

        if stale_files.is_empty() {
            return Ok(());
        }

        self.index_files(workspace, &stale_files).await?;
        self.load_from_db(workspace).map_err(|e| {
            VectorStoreError::DatastoreError(format!("reload after sync failed: {e}").into())
        })?;

        Ok(())
    }

    async fn index_files(&self, workspace: &Path, files: &[PathBuf]) -> Result<usize, VectorStoreError> {
        let ws_str = workspace.to_string_lossy().to_string();

        let model = self.build_model().ok_or_else(|| {
            VectorStoreError::DatastoreError("not authenticated".into())
        })?;

        let mut chunks: Vec<(String, CodeChunk, String)> = Vec::new();
        for file_path in files {
            let rel = relative_path(workspace, file_path);
            self.delete_file_chunks(&ws_str, &rel)?;
            let text = match std::fs::read_to_string(file_path) {
                Ok(t) => t,
                Err(_) => continue,
            };
            let fhash = content_hash(&text);
            for (start_line, end_line, content) in chunk_text(&text) {
                let chunk_id = make_chunk_id(&ws_str, &rel, start_line);
                chunks.push((chunk_id, CodeChunk { file_path: rel.clone(), start_line, end_line, content }, fhash.clone()));
            }
        }

        if chunks.is_empty() {
            return Ok(0);
        }

        let count = chunks.len();
        let docs: Vec<CodeChunk> = chunks.iter().map(|(_, c, _)| c.clone()).collect();

        let embeddings = EmbeddingsBuilder::new(model)
            .documents(docs)
            .map_err(|e| VectorStoreError::DatastoreError(e.to_string().into()))?
            .build()
            .await?;

        let now = now_secs();
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        for ((chunk_id, chunk, file_hash), (_, one_or_many)) in chunks.iter().zip(embeddings.iter()) {
            let blob = floats_to_blob(&one_or_many.first().vec);
            conn.execute(
                "INSERT INTO vector_chunks
                    (id, workspace, file_path, start_line, end_line, content, content_hash, embedding, indexed_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
                 ON CONFLICT(id) DO UPDATE SET
                    content=?6, content_hash=?7, embedding=?8, indexed_at=?9",
                params![
                    chunk_id,
                    ws_str,
                    chunk.file_path,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
                    chunk.content,
                    file_hash,
                    blob,
                    now as i64,
                ],
            )
            .map_err(|e| VectorStoreError::DatastoreError(e.to_string().into()))?;
        }

        Ok(count)
    }

    pub async fn index_workspace(&self, workspace: &Path) -> Result<usize, VectorStoreError> {
        let files = collect_files(workspace);
        if files.is_empty() {
            return Ok(0);
        }

        let ws_str = workspace.to_string_lossy().to_string();
        let stored_hashes = self.load_hashes(&ws_str)?;
        let live_rels: std::collections::HashSet<String> =
            files.iter().map(|f| relative_path(workspace, f)).collect();

        self.delete_removed_files(&ws_str, &live_rels)?;

        let stale: Vec<PathBuf> = files
            .iter()
            .filter(|f| {
                let rel = relative_path(workspace, f);
                let current = file_hash(f);
                match (current, stored_hashes.get(&rel)) {
                    (Some(ch), Some(sh)) => &ch != sh,
                    (None, _) => false,
                    (Some(_), None) => true,
                }
            })
            .cloned()
            .collect();

        let indexed = if stale.is_empty() {
            0
        } else {
            self.index_files(workspace, &stale).await?
        };

        self.load_from_db(workspace).map_err(|e| {
            VectorStoreError::DatastoreError(format!("reload after index failed: {e}").into())
        })?;

        Ok(indexed)
    }

    pub async fn search(
        &self,
        workspace: &Path,
        query: &str,
        top_k: usize,
    ) -> Result<Vec<(f64, String, CodeChunk)>, VectorStoreError> {
        self.ensure_indexed(workspace).await?;

        let model = self.build_model().ok_or_else(|| {
            VectorStoreError::DatastoreError("not authenticated".into())
        })?;

        let store = {
            let guard = self
                .inner
                .read()
                .map_err(|_| VectorStoreError::DatastoreError("index lock poisoned".into()))?;
            guard
                .as_ref()
                .ok_or_else(|| VectorStoreError::DatastoreError("index not built".into()))?
                .store
                .clone()
        };

        let index = store.index(model);
        let req = VectorSearchRequest::builder()
            .query(query)
            .samples(top_k as u64)
            .build();

        index.top_n::<CodeChunk>(req).await
    }

    fn load_hashes(&self, workspace: &str) -> Result<std::collections::HashMap<String, String>, VectorStoreError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn
            .prepare(
                "SELECT file_path, content_hash FROM vector_chunks
                 WHERE workspace = ?1
                 GROUP BY file_path",
            )
            .map_err(|e| VectorStoreError::DatastoreError(e.to_string().into()))?;

        let rows = stmt
            .query_map(params![workspace], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| VectorStoreError::DatastoreError(e.to_string().into()))?;

        let mut map = std::collections::HashMap::new();
        for row in rows.flatten() {
            map.insert(row.0, row.1);
        }
        Ok(map)
    }

    fn delete_file_chunks(&self, workspace: &str, file_path: &str) -> Result<(), VectorStoreError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "DELETE FROM vector_chunks WHERE workspace = ?1 AND file_path = ?2",
            params![workspace, file_path],
        )
        .map_err(|e| VectorStoreError::DatastoreError(e.to_string().into()))?;
        Ok(())
    }

    fn delete_removed_files(
        &self,
        workspace: &str,
        live_rels: &std::collections::HashSet<String>,
    ) -> Result<(), VectorStoreError> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn
            .prepare("SELECT DISTINCT file_path FROM vector_chunks WHERE workspace = ?1")
            .map_err(|e| VectorStoreError::DatastoreError(e.to_string().into()))?;

        let stored: Vec<String> = stmt
            .query_map(params![workspace], |row| row.get(0))
            .map_err(|e| VectorStoreError::DatastoreError(e.to_string().into()))?
            .flatten()
            .collect();

        drop(stmt);

        for file in stored {
            if !live_rels.contains(&file) {
                conn.execute(
                    "DELETE FROM vector_chunks WHERE workspace = ?1 AND file_path = ?2",
                    params![workspace, file],
                )
                .map_err(|e| VectorStoreError::DatastoreError(e.to_string().into()))?;
            }
        }
        Ok(())
    }
}

fn chunk_text(text: &str) -> Vec<(usize, usize, String)> {
    let lines: Vec<&str> = text.lines().collect();
    let total = lines.len();
    if total == 0 {
        return vec![];
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < total {
        let end = (start + CHUNK_LINES).min(total);
        let content = lines[start..end].join("\n");
        let trimmed = content.trim().to_string();
        if !trimmed.is_empty() {
            chunks.push((start + 1, end, trimmed));
        }
        if end >= total {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP);
    }
    chunks
}

fn collect_files(workspace: &Path) -> Vec<PathBuf> {
    let walker = ignore::WalkBuilder::new(workspace)
        .git_ignore(true)
        .filter_entry(|e| !SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
        .build();
    let mut files = Vec::new();
    for entry in walker.flatten() {
        let path = entry.into_path();
        if should_index(&path) {
            files.push(path);
        }
    }
    files
}

fn should_index(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if let Ok(meta) = path.metadata() {
        if meta.len() > MAX_FILE_BYTES {
            return false;
        }
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    !SKIP_EXTS.contains(&ext.as_str())
}

fn relative_path(workspace: &Path, file: &Path) -> String {
    file.strip_prefix(workspace)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| file.to_string_lossy().replace('\\', "/"))
}

fn make_chunk_id(workspace: &str, file_path: &str, start_line: usize) -> String {
    let input = format!("{workspace}\x00{file_path}\x00{start_line}");
    let hash = Sha256::digest(input.as_bytes());
    format!("{:016x}", u64::from_be_bytes(hash[..8].try_into().unwrap_or([0u8; 8])))
}

fn content_hash(text: &str) -> String {
    let hash = Sha256::digest(text.as_bytes());
    format!("{:016x}", u64::from_be_bytes(hash[..8].try_into().unwrap_or([0u8; 8])))
}

fn file_hash(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    Some(content_hash(&text))
}

fn floats_to_blob(floats: &[f64]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(floats.len() * 8);
    for f in floats {
        buf.extend_from_slice(&f.to_le_bytes());
    }
    buf
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
