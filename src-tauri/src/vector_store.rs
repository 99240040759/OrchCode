use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::UNIX_EPOCH;

use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::config;
use crate::error::{AppError, AppResult};
use crate::gateway::Gateway;
use crate::persistence::configure_connection;
use crate::tools::fs_util;

const CHUNK_LINES: usize = 40;
const CHUNK_OVERLAP: usize = 8;
const MAX_FILE_BYTES: u64 = 256 * 1024;

const SKIP_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "pdf", "zip", "tar", "gz", "7z",
    "rar", "exe", "dll", "so", "dylib", "bin", "wasm", "lock", "sum", "ttf", "otf", "woff",
    "woff2", "mp3", "mp4", "mov", "wav", "ogg",
];

#[derive(Clone, Debug, Serialize)]
pub struct CodeChunk {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
}

struct IndexEntry {
    chunk: CodeChunk,
    embedding: Vec<f32>,
    norm: f32,
}

struct IndexState {
    workspace: PathBuf,
    entries: Vec<IndexEntry>,
}

struct StaleFile {
    rel: String,
    content_hash: String,
    mtime_ms: i64,
    size_bytes: i64,
    chunks: Vec<(usize, usize, String)>,
}

struct ScanResult {
    stale: Vec<StaleFile>,
    removed: Vec<String>,
}

#[derive(Clone)]
pub struct WorkspaceIndex {
    inner: Arc<RwLock<Option<IndexState>>>,
    conn: Arc<Mutex<Connection>>,
    gateway: Arc<Gateway>,
}

impl WorkspaceIndex {
    pub fn open(db_path: &Path, gateway: Arc<Gateway>) -> AppResult<Self> {
        let conn = Connection::open(db_path)
            .map_err(|e| AppError::other(format!("vector store open failed: {e}")))?;
        configure_connection(&conn)?;
        Ok(Self {
            inner: Arc::new(RwLock::new(None)),
            conn: Arc::new(Mutex::new(conn)),
            gateway,
        })
    }

    pub fn chunk_count(&self, workspace: &Path) -> usize {
        self.inner
            .read()
            .ok()
            .and_then(|g| {
                g.as_ref().map(|s| {
                    if s.workspace == workspace {
                        s.entries.len()
                    } else {
                        0
                    }
                })
            })
            .unwrap_or(0)
    }

    pub async fn search(
        &self,
        workspace: &Path,
        query: &str,
        top_k: usize,
    ) -> AppResult<Vec<(f32, CodeChunk)>> {
        self.sync(workspace).await?;

        let mut embeddings = self.gateway.embed(vec![query.to_string()]).await?;
        let query_vec = embeddings
            .pop()
            .ok_or_else(|| AppError::other("embedding service returned no query vector"))?;
        let query_norm = norm_of(&query_vec);
        if query_norm == 0.0 {
            return Ok(Vec::new());
        }

        let guard = self
            .inner
            .read()
            .map_err(|_| AppError::other("vector index lock poisoned"))?;
        let state = match guard.as_ref() {
            Some(s) if s.workspace == workspace => s,
            _ => return Ok(Vec::new()),
        };

        let mut scored: Vec<(f32, &CodeChunk)> = state
            .entries
            .iter()
            .filter(|e| e.norm > 0.0 && e.embedding.len() == query_vec.len())
            .map(|e| {
                let dot: f32 = e
                    .embedding
                    .iter()
                    .zip(query_vec.iter())
                    .map(|(a, b)| a * b)
                    .sum();
                (dot / (e.norm * query_norm), &e.chunk)
            })
            .collect();

        scored.sort_by(|a, b| b.0.total_cmp(&a.0));
        Ok(scored
            .into_iter()
            .take(top_k)
            .map(|(score, chunk)| (score, chunk.clone()))
            .collect())
    }

    async fn sync(&self, workspace: &Path) -> AppResult<()> {
        let ws_key = workspace_key(workspace);
        let ws_path = workspace.to_path_buf();
        let conn = self.conn.clone();

        let scan = {
            let conn = conn.clone();
            let ws_key = ws_key.clone();
            let ws_path = ws_path.clone();
            tokio::task::spawn_blocking(move || scan_workspace(&conn, &ws_key, &ws_path))
                .await
                .map_err(|e| AppError::other(format!("index scan task failed: {e}")))??
        };

        let cache_matches = self
            .inner
            .read()
            .map_err(|_| AppError::other("vector index lock poisoned"))?
            .as_ref()
            .map(|s| s.workspace == ws_path)
            .unwrap_or(false);

        if scan.stale.is_empty() && scan.removed.is_empty() && cache_matches {
            return Ok(());
        }

        let mut texts: Vec<String> = Vec::new();
        for file in &scan.stale {
            for (start, end, content) in &file.chunks {
                texts.push(format!(
                    "file: {}\nlines: {}-{}\n\n{}",
                    file.rel, start, end, content
                ));
            }
        }

        let mut vectors: Vec<Vec<f32>> = Vec::with_capacity(texts.len());
        for batch in texts.chunks(config::EMBEDDING_BATCH_SIZE) {
            let embedded = self.gateway.embed(batch.to_vec()).await?;
            vectors.extend(embedded);
        }

        if vectors.len() != texts.len() {
            return Err(AppError::other(
                "embedding service returned an unexpected number of vectors",
            ));
        }

        let entries = {
            let conn = conn.clone();
            let ws_key = ws_key.clone();
            tokio::task::spawn_blocking(move || persist_and_load(&conn, &ws_key, scan, vectors))
                .await
                .map_err(|e| AppError::other(format!("index write task failed: {e}")))??
        };

        let mut guard = self
            .inner
            .write()
            .map_err(|_| AppError::other("vector index lock poisoned"))?;
        *guard = Some(IndexState {
            workspace: ws_path,
            entries,
        });
        Ok(())
    }

    pub fn invalidate(&self) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = None;
        }
    }
}

fn scan_workspace(
    conn: &Arc<Mutex<Connection>>,
    ws_key: &str,
    workspace: &Path,
) -> AppResult<ScanResult> {
    let files = collect_files(workspace);
    let live: HashSet<String> = files.iter().map(|(rel, _)| rel.clone()).collect();

    let stored = {
        let c = conn.lock().map_err(|_| lock_poisoned())?;
        let mut stmt = c
            .prepare(
                "SELECT file_path, content_hash, mtime_ms, size_bytes FROM vector_files WHERE workspace = ?1",
            )
            .map_err(sql_err)?;
        let rows = stmt
            .query_map(params![ws_key], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    (
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ),
                ))
            })
            .map_err(sql_err)?;
        let mut map: HashMap<String, (String, i64, i64)> = HashMap::new();
        for row in rows {
            let (k, v) = row.map_err(sql_err)?;
            map.insert(k, v);
        }
        map
    };

    let removed: Vec<String> = stored
        .keys()
        .filter(|k| !live.contains(*k))
        .cloned()
        .collect();

    let mut stale = Vec::new();
    for (rel, path) in files {
        let meta = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size_bytes = meta.len() as i64;
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        if let Some((_, stored_mtime, stored_size)) = stored.get(&rel) {
            if *stored_mtime == mtime_ms && *stored_size == size_bytes {
                continue;
            }
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let content_hash = content_hash(&content);
        if let Some((stored_hash, _, _)) = stored.get(&rel) {
            if stored_hash == &content_hash {
                let c = conn.lock().map_err(|_| lock_poisoned())?;
                c.execute(
                    "UPDATE vector_files SET mtime_ms = ?1, size_bytes = ?2 WHERE workspace = ?3 AND file_path = ?4",
                    params![mtime_ms, size_bytes, ws_key, rel],
                )
                .map_err(sql_err)?;
                continue;
            }
        }

        let chunks = chunk_text(&content);
        if chunks.is_empty() {
            continue;
        }

        stale.push(StaleFile {
            rel,
            content_hash,
            mtime_ms,
            size_bytes,
            chunks,
        });
    }

    Ok(ScanResult { stale, removed })
}

fn persist_and_load(
    conn: &Arc<Mutex<Connection>>,
    ws_key: &str,
    scan: ScanResult,
    vectors: Vec<Vec<f32>>,
) -> AppResult<Vec<IndexEntry>> {
    {
        let mut c = conn.lock().map_err(|_| lock_poisoned())?;
        let tx = c.transaction().map_err(sql_err)?;

        for rel in &scan.removed {
            tx.execute(
                "DELETE FROM vector_chunks WHERE workspace = ?1 AND file_path = ?2",
                params![ws_key, rel],
            )
            .map_err(sql_err)?;
            tx.execute(
                "DELETE FROM vector_files WHERE workspace = ?1 AND file_path = ?2",
                params![ws_key, rel],
            )
            .map_err(sql_err)?;
        }

        let mut cursor = 0usize;
        for file in &scan.stale {
            tx.execute(
                "DELETE FROM vector_chunks WHERE workspace = ?1 AND file_path = ?2",
                params![ws_key, file.rel],
            )
            .map_err(sql_err)?;

            for (start, end, content) in &file.chunks {
                let vector = &vectors[cursor];
                cursor += 1;
                let id = chunk_id(ws_key, &file.rel, *start);
                tx.execute(
                    "INSERT INTO vector_chunks (id, workspace, file_path, start_line, end_line, content, embedding)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        id,
                        ws_key,
                        file.rel,
                        *start as i64,
                        *end as i64,
                        content,
                        floats_to_blob(vector)
                    ],
                )
                .map_err(sql_err)?;
            }

            tx.execute(
                "INSERT INTO vector_files (workspace, file_path, content_hash, mtime_ms, size_bytes)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(workspace, file_path) DO UPDATE SET content_hash = ?3, mtime_ms = ?4, size_bytes = ?5",
                params![ws_key, file.rel, file.content_hash, file.mtime_ms, file.size_bytes],
            )
            .map_err(sql_err)?;
        }

        tx.commit().map_err(sql_err)?;
    }

    let c = conn.lock().map_err(|_| lock_poisoned())?;
    let mut stmt = c
        .prepare(
            "SELECT file_path, start_line, end_line, content, embedding FROM vector_chunks WHERE workspace = ?1",
        )
        .map_err(sql_err)?;
    let rows = stmt
        .query_map(params![ws_key], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)? as usize,
                row.get::<_, i64>(2)? as usize,
                row.get::<_, String>(3)?,
                row.get::<_, Vec<u8>>(4)?,
            ))
        })
        .map_err(sql_err)?;

    let mut entries = Vec::new();
    for row in rows {
        let (file_path, start_line, end_line, content, blob) = row.map_err(sql_err)?;
        let embedding = blob_to_floats(&blob);
        if embedding.is_empty() {
            continue;
        }
        let norm = norm_of(&embedding);
        entries.push(IndexEntry {
            chunk: CodeChunk {
                file_path,
                start_line,
                end_line,
                content,
            },
            embedding,
            norm,
        });
    }
    Ok(entries)
}

fn chunk_text(text: &str) -> Vec<(usize, usize, String)> {
    let lines: Vec<&str> = text.lines().collect();
    let total = lines.len();
    if total == 0 {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    loop {
        let end = (start + CHUNK_LINES).min(total);
        let content = lines[start..end].join("\n");
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            chunks.push((start + 1, end, trimmed.to_string()));
        }
        if end >= total {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP);
    }
    chunks
}

fn collect_files(workspace: &Path) -> Vec<(String, PathBuf)> {
    let mut files = Vec::new();
    for entry in fs_util::workspace_walker(workspace).build().flatten() {
        let path = entry.into_path();
        if !should_index(&path) {
            continue;
        }
        files.push((fs_util::display_relative(workspace, &path), path));
    }
    files
}

fn should_index(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    match path.metadata() {
        Ok(meta) if meta.len() <= MAX_FILE_BYTES => {}
        _ => return false,
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    !SKIP_EXTS.contains(&ext.as_str())
}

fn workspace_key(workspace: &Path) -> String {
    workspace.to_string_lossy().replace('\\', "/")
}

fn chunk_id(ws_key: &str, file_path: &str, start_line: usize) -> String {
    digest_hex(&format!("{ws_key}\u{0}{file_path}\u{0}{start_line}"))
}

fn content_hash(text: &str) -> String {
    digest_hex(text)
}

fn digest_hex(input: &str) -> String {
    let hash = Sha256::digest(input.as_bytes());
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

fn floats_to_blob(floats: &[f32]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(floats.len() * 4);
    for f in floats {
        buf.extend_from_slice(&f.to_le_bytes());
    }
    buf
}

fn blob_to_floats(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

fn norm_of(vector: &[f32]) -> f32 {
    vector.iter().map(|v| v * v).sum::<f32>().sqrt()
}

fn sql_err(e: rusqlite::Error) -> AppError {
    AppError::other(format!("vector store sqlite error: {e}"))
}

fn lock_poisoned() -> AppError {
    AppError::other("vector store connection lock poisoned")
}
