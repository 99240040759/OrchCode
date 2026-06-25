import { getDb } from './db';
import type { Workspace, Conversation, DBMessage, DBPart, DBArtifact, UIMessage } from '../ipc/types';
import { buildUIMessages } from '../ipc/types';
const now = () => Date.now();
const msgRow = (r: any): DBMessage => ({ id: r.id, convId: r.conv_id, role: r.role, seq: r.seq, status: r.status, error: r.error, model: r.model, compacted: r.compacted, createdAt: r.created_at, updatedAt: r.updated_at });
const partRow = (r: any): DBPart => ({ id: r.id, messageId: r.message_id, convId: r.conv_id, seq: r.seq, type: r.type, text: r.text, toolCallId: r.tool_call_id, toolName: r.tool_name, toolArgs: r.tool_args, toolResult: r.tool_result, toolStatus: r.tool_status, toolMeta: r.tool_meta, artifactId: r.artifact_id, path: r.path, createdAt: r.created_at, updatedAt: r.updated_at });
const artRow = (r: any): DBArtifact => ({ id: r.id, convId: r.conv_id, messageId: r.message_id, partId: r.part_id, kind: r.kind, mime: r.mime, name: r.name, data: r.data, createdAt: r.created_at });
export const q = {
  // ─── Workspaces ─────────────────────────────────────────────────────────────
  getWorkspaces: () => getDb().prepare(`SELECT * FROM workspaces ORDER BY created_at ASC`).all().map((r: any) => ({ id: r.id, name: r.name, path: r.path, createdAt: r.created_at })) as Workspace[],
  createWorkspace: (w: Workspace) => getDb().prepare(`INSERT INTO workspaces (id,name,path,created_at) VALUES (?,?,?,?)`).run(w.id, w.name, w.path, w.createdAt),
  deleteWorkspace: (id: string) => getDb().prepare(`DELETE FROM workspaces WHERE id=?`).run(id),
  // ─── Conversations ──────────────────────────────────────────────────────────
  getConversations: (workspaceId: string | null) => (workspaceId === null
    ? getDb().prepare(`SELECT * FROM conversations WHERE workspace_id IS NULL ORDER BY updated_at DESC`).all()
    : getDb().prepare(`SELECT * FROM conversations WHERE workspace_id=? ORDER BY updated_at DESC`).all(workspaceId)
  ).map((r: any) => ({ id: r.id, workspaceId: r.workspace_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at })) as Conversation[],
  createConversation: (c: Conversation) => getDb().prepare(`INSERT INTO conversations (id,workspace_id,title,created_at,updated_at) VALUES (?,?,?,?,?)`).run(c.id, c.workspaceId, c.title, c.createdAt, c.updatedAt),
  updateConversation: (id: string, patch: Partial<Conversation>) => {
    if (patch.title !== undefined) getDb().prepare(`UPDATE conversations SET title=?, updated_at=? WHERE id=?`).run(patch.title, patch.updatedAt ?? now(), id);
    else getDb().prepare(`UPDATE conversations SET updated_at=? WHERE id=?`).run(patch.updatedAt ?? now(), id);
  },
  touchConversation: (id: string) => getDb().prepare(`UPDATE conversations SET updated_at=? WHERE id=?`).run(now(), id),
  deleteConversation: (id: string) => getDb().transaction(() => {
    const db = getDb();
    db.prepare(`DELETE FROM artifacts WHERE conv_id=?`).run(id);
    db.prepare(`DELETE FROM parts WHERE conv_id=?`).run(id);
    db.prepare(`DELETE FROM messages WHERE conv_id=?`).run(id);
    db.prepare(`DELETE FROM conversations WHERE id=?`).run(id);
  })(),
  // ─── Messages ───
  nextSeq: (convId: string): number => (getDb().prepare(`SELECT COALESCE(MAX(seq),-1)+1 AS n FROM messages WHERE conv_id=?`).get(convId) as any).n,
  insertMessage: (m: DBMessage) => getDb().prepare(`INSERT INTO messages (id,conv_id,role,seq,status,error,model,compacted,created_at,updated_at) VALUES (@id,@convId,@role,@seq,@status,@error,@model,@compacted,@createdAt,@updatedAt) ON CONFLICT(id) DO UPDATE SET status=@status, error=@error, updated_at=@updatedAt`).run(m as any),
  setMessageStatus: (id: string, status: string, error?: string | null) => getDb().prepare(`UPDATE messages SET status=?, error=?, updated_at=? WHERE id=?`).run(status, error ?? null, now(), id),
  markCompacted: (ids: string[]) => { if (!ids.length) return; const ph = ids.map(() => '?').join(','); getDb().prepare(`UPDATE messages SET compacted=1 WHERE id IN (${ph})`).run(...ids); },
  getMessages: (convId: string) => getDb().prepare(`SELECT * FROM messages WHERE conv_id=? ORDER BY seq ASC`).all(convId).map(msgRow),
  // ─── Parts ───
  insertPart: (p: DBPart) => getDb().prepare(`INSERT INTO parts (id,message_id,conv_id,seq,type,text,tool_call_id,tool_name,tool_args,tool_result,tool_status,tool_meta,artifact_id,path,created_at,updated_at) VALUES (@id,@messageId,@convId,@seq,@type,@text,@toolCallId,@toolName,@toolArgs,@toolResult,@toolStatus,@toolMeta,@artifactId,@path,@createdAt,@updatedAt) ON CONFLICT(id) DO NOTHING`).run(p as any),
  setPartText: (id: string, text: string) => getDb().prepare(`UPDATE parts SET text=?, updated_at=? WHERE id=?`).run(text, now(), id),
  setPartTool: (id: string, status: string, result: string | null, meta: string | null) => getDb().prepare(`UPDATE parts SET tool_status=?, tool_result=COALESCE(?,tool_result), tool_meta=COALESCE(?,tool_meta), updated_at=? WHERE id=?`).run(status, result, meta, now(), id),
  getParts: (convId: string) => getDb().prepare(`SELECT * FROM parts WHERE conv_id=? ORDER BY seq ASC`).all(convId).map(partRow),
  getPartsForMessage: (messageId: string) => getDb().prepare(`SELECT * FROM parts WHERE message_id=? ORDER BY seq ASC`).all(messageId).map(partRow),
  // ─── Artifacts ───
  insertArtifact: (a: DBArtifact) => getDb().prepare(`INSERT INTO artifacts (id,conv_id,message_id,part_id,kind,mime,name,data,created_at) VALUES (@id,@convId,@messageId,@partId,@kind,@mime,@name,@data,@createdAt) ON CONFLICT(id) DO NOTHING`).run(a as any),
  getArtifacts: (convId: string) => getDb().prepare(`SELECT * FROM artifacts WHERE conv_id=?`).all(convId).map(artRow),
  getArtifact: (id: string) => { const r = getDb().prepare(`SELECT * FROM artifacts WHERE id=?`).get(id); return r ? artRow(r) : null; },
  // ─── Aggregate loads ───
  loadConversation: (convId: string): UIMessage[] => buildUIMessages(q.getMessages(convId), q.getParts(convId), q.getArtifacts(convId)),
  // ─── Settings / stats ───
  getSetting: (key: string) => getDb().prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value: string } | undefined,
  setSetting: (key: string, value: string) => getDb().prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?`).run(key, value, value),
  isFirstLaunch: () => { const s = q.getSetting('firstLaunch'); return !s || s.value !== 'done'; },
  setFirstLaunchDone: () => q.setSetting('firstLaunch', 'done'),
  addLifetimeTokens: (count: number) => q.setSetting('lifetimeTokens', String(parseInt(q.getSetting('lifetimeTokens')?.value || '0', 10) + count)),
  getLifetimeTokens: () => parseInt(q.getSetting('lifetimeTokens')?.value || '0', 10),
  getConversationCount: () => (getDb().prepare(`SELECT COUNT(*) AS c FROM conversations`).get() as any).c || 0,
  getMessageCount: () => (getDb().prepare(`SELECT COUNT(*) AS c FROM messages`).get() as any).c || 0,
};
