import { create } from 'zustand';
import type { UIMessage, MessagePart, ToolPart, Message } from '../ipc/types';
export interface ConvState {
  messages: UIMessage[];
  currentMessage: UIMessage | null;   // grows during streaming
  isStreaming: boolean;
  tokenCount: number;
  workspaceId: string | null;
  agentReady: boolean;
}
interface ConversationsStore {
  convs: Map<string, ConvState>;
  activeConvId: string | null;
  setActiveConv: (id: string | null) => void;
  initConv: (convId: string, workspaceId: string | null, messages: UIMessage[]) => void;
  removeConv: (convId: string) => void;
  // Streaming actions
  startIteration: (convId: string, messageId: string) => void;
  appendChunk: (convId: string, delta: string, tokenCount: number, messageId: string) => void;
  addToolCall: (convId: string, tc: { id: string; name: string; input: string }) => void;
  updateToolCall: (convId: string, tcId: string, patch: Partial<ToolPart>) => void;
  commitCurrentMessage: (convId: string) => void;
  finalizeStream: (convId: string) => void;
  cancelStream: (convId: string) => void;
  // Other
  setAgentReady: (convId: string) => void;
  getConv: (convId: string) => ConvState | undefined;
  replaceWithSummary: (convId: string, summaryMsg: Message) => void;
  setTokenCount: (convId: string, count: number) => void;
  addMessage: (convId: string, msg: UIMessage) => void;
}
const defaultConv = (workspaceId: string | null): ConvState => ({ messages: [], currentMessage: null, isStreaming: false, tokenCount: 0, workspaceId, agentReady: false });
function mut<T>(s: Map<string, T>, id: string, fn: (c: T) => T): Map<string, T> { const n = new Map(s); const c = s.get(id); if (c) n.set(id, fn(c)); return n; }
export const useConversationsStore = create<ConversationsStore>((set, get) => ({
  convs: new Map(),
  activeConvId: null,
  setActiveConv: (id) => set({ activeConvId: id }),
  initConv: (convId, workspaceId, messages) => set(s => {
    const next = new Map(s.convs);
    next.set(convId, { ...defaultConv(workspaceId), messages, agentReady: s.convs.get(convId)?.agentReady || false });
    return { convs: next };
  }),
  removeConv: (convId) => set(s => {
    const next = new Map(s.convs); next.delete(convId);
    return { convs: next, activeConvId: s.activeConvId === convId ? null : s.activeConvId };
  }),
  // Called when worker signals a new iteration is starting — commits previous currentMessage
  startIteration: (convId, messageId) => set(s => ({
    convs: mut(s.convs, convId, c => {
      const msgs = c.currentMessage ? [...c.messages, c.currentMessage] : c.messages;
      return { ...c, messages: msgs, currentMessage: { id: messageId, convId, role: 'assistant', parts: [], createdAt: Date.now() }, isStreaming: true };
    })
  })),
  appendChunk: (convId, delta, tokenCount, messageId) => set(s => ({
    convs: mut(s.convs, convId, c => {
      let cur = c.currentMessage;
      if (!cur) cur = { id: messageId, convId, role: 'assistant', parts: [], createdAt: Date.now() };
      const parts = [...cur.parts];
      const last = parts[parts.length - 1];
      if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + delta };
      else parts.push({ type: 'text', text: delta });
      const liveCount = tokenCount + Math.ceil(parts.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 0), 0) / 4);
      return { ...c, currentMessage: { ...cur, parts }, isStreaming: true, tokenCount: liveCount };
    })
  })),
  addToolCall: (convId, tc) => set(s => ({
    convs: mut(s.convs, convId, c => {
      let cur = c.currentMessage;
      if (!cur) cur = { id: `tc-${Date.now()}`, convId, role: 'assistant', parts: [], createdAt: Date.now() };
      const part: ToolPart = { type: 'tool-call', id: tc.id, name: tc.name, input: tc.input };
      return { ...c, currentMessage: { ...cur, parts: [...cur.parts, part] } };
    })
  })),
  updateToolCall: (convId, tcId, patch) => set(s => ({
    convs: mut(s.convs, convId, c => {
      const updateInMsg = (msg: UIMessage): UIMessage => ({
        ...msg, parts: msg.parts.map(p => p.type === 'tool-call' && p.id === tcId ? { ...p, ...patch } : p)
      });
      const currentMessage = c.currentMessage ? updateInMsg(c.currentMessage) : null;
      const messages = c.messages.map(updateInMsg);
      return { ...c, currentMessage, messages };
    })
  })),
  commitCurrentMessage: (convId) => set(s => ({
    convs: mut(s.convs, convId, c => {
      if (!c.currentMessage) return c;
      return { ...c, messages: [...c.messages, c.currentMessage], currentMessage: null };
    })
  })),
  finalizeStream: (convId) => set(s => ({
    convs: mut(s.convs, convId, c => {
      const msgs = c.currentMessage ? [...c.messages, c.currentMessage] : c.messages;
      return { ...c, messages: msgs, currentMessage: null, isStreaming: false };
    })
  })),
  cancelStream: (convId) => set(s => ({
    convs: mut(s.convs, convId, c => {
      const msgs = c.currentMessage ? [...c.messages, c.currentMessage] : c.messages;
      return { ...c, messages: msgs, currentMessage: null, isStreaming: false, agentReady: false };
    })
  })),
  setAgentReady: (convId) => set(s => {
    const c = s.convs.get(convId) || defaultConv(null);
    const next = new Map(s.convs); next.set(convId, { ...c, agentReady: true });
    return { convs: next };
  }),
  getConv: (convId) => get().convs.get(convId),
  replaceWithSummary: (convId, summaryMsg) => set(s => ({
    convs: mut(s.convs, convId, c => {
      const summaryUI: UIMessage = { id: summaryMsg.id, convId, role: 'system', parts: [{ type: 'text', text: summaryMsg.content }], createdAt: summaryMsg.createdAt };
      const kept = c.messages.slice(-10);
      return { ...c, messages: [summaryUI, ...kept], currentMessage: null };
    })
  })),
  setTokenCount: (convId, count) => set(s => ({ convs: mut(s.convs, convId, c => ({ ...c, tokenCount: count })) })),
  addMessage: (convId, msg) => set(s => ({
    convs: mut(s.convs, convId, c => ({ ...c, messages: [...c.messages, msg], isStreaming: true, currentMessage: null }))
  })),
}));
