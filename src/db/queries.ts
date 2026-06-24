import { eq, asc, desc, sql, isNull } from 'drizzle-orm';
import { getDb, workspaces, conversations, messages, toolCalls, settings } from './db';
import type { Workspace, Conversation, Message, ToolCall, UIMessage } from '../ipc/types';
import { dbRowsToUIMessages } from '../ipc/types';
export const q = {
  getWorkspaces: () => getDb().select().from(workspaces).orderBy(asc(workspaces.createdAt)).all() as Workspace[],
  createWorkspace: (w: Workspace) => getDb().insert(workspaces).values(w).run(),
  deleteWorkspace: (id: string) => { getDb().delete(workspaces).where(eq(workspaces.id, id)).run(); },
  getConversations: (workspaceId: string | null) => {
    const db = getDb();
    return (workspaceId === null
      ? db.select().from(conversations).where(isNull(conversations.workspaceId)).orderBy(desc(conversations.updatedAt))
      : db.select().from(conversations).where(eq(conversations.workspaceId, workspaceId)).orderBy(desc(conversations.updatedAt))
    ).all() as Conversation[];
  },
  createConversation: (c: Conversation) => getDb().insert(conversations).values(c).run(),
  updateConversation: (id: string, patch: Partial<Conversation>) => getDb().update(conversations).set(patch).where(eq(conversations.id, id)).run(),
  deleteConversation: (id: string) => getDb().transaction(tx => { tx.delete(toolCalls).where(eq(toolCalls.convId, id)).run(); tx.delete(messages).where(eq(messages.convId, id)).run(); tx.delete(conversations).where(eq(conversations.id, id)).run(); }),
  getMessages: (convId: string) => getDb().select().from(messages).where(eq(messages.convId, convId)).orderBy(asc(messages.createdAt)).all() as Message[],
  writeMessage: (m: Message) => getDb().insert(messages).values(m).onConflictDoUpdate({ target: messages.id, set: { content: m.content, tokenCount: m.tokenCount, toolCallId: m.toolCallId } }).run(),
  writeToolCall: (tc: ToolCall) => {
    const set: Record<string, unknown> = {};
    if (tc.output !== undefined) set.output = tc.output;
    if (tc.startLine !== undefined) set.startLine = tc.startLine;
    if (tc.endLine !== undefined) set.endLine = tc.endLine;
    if (tc.diffAdded !== undefined) set.diffAdded = tc.diffAdded;
    if (tc.diffRemoved !== undefined) set.diffRemoved = tc.diffRemoved;
    const stmt = getDb().insert(toolCalls).values(tc);
    return (Object.keys(set).length ? stmt.onConflictDoUpdate({ target: toolCalls.id, set }) : stmt.onConflictDoNothing()).run();
  },
  getToolCalls: (convId: string) => getDb().select().from(toolCalls).where(eq(toolCalls.convId, convId)).orderBy(asc(toolCalls.createdAt)).all() as ToolCall[],
  loadConversation: (convId: string): UIMessage[] => {
    const msgs = q.getMessages(convId);
    const tcs = q.getToolCalls(convId);
    return dbRowsToUIMessages(msgs, tcs);
  },
  getSetting: (key: string) => getDb().select().from(settings).where(eq(settings.key, key)).get() as { key: string; value: string } | undefined,
  setSetting: (key: string, value: string) => getDb().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run(),
  isFirstLaunch: () => { const s = q.getSetting('firstLaunch'); return !s || s.value !== 'done'; },
  setFirstLaunchDone: () => q.setSetting('firstLaunch', 'done'),
  addLifetimeTokens: (count: number) => {
    const cur = parseInt(q.getSetting('lifetimeTokens')?.value || '0', 10);
    q.setSetting('lifetimeTokens', String(cur + count));
  },
  getLifetimeTokens: () => parseInt(q.getSetting('lifetimeTokens')?.value || '0', 10),
  getConversationCount: () => getDb().select({ count: sql<number>`count(*)` }).from(conversations).get()?.count || 0,
  getMessageCount: () => getDb().select({ count: sql<number>`count(*)` }).from(messages).get()?.count || 0,
};
