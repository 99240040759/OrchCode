import { create } from 'zustand';
import type { UIMessage, ToolPart, Message } from '../ipc/types';
export interface ConvState { messages: UIMessage[]; currentMessage: UIMessage | null; isStreaming: boolean; tokenCount: number; workspaceId: string | null; agentReady: boolean; }
interface ConversationsStore {
  convs: Record<string, ConvState>; activeConvId: string | null;
  setActiveConv: (id: string | null) => void;
  initConv: (convId: string, workspaceId: string | null, messages: UIMessage[]) => void;
  removeConv: (convId: string) => void;
  startIteration: (convId: string, messageId: string) => void;
  appendChunk: (convId: string, delta: string, tokenCount: number, messageId: string) => void;
  addToolCall: (convId: string, tc: { id: string; name: string; input: string }) => void;
  updateToolCall: (convId: string, tcId: string, patch: Partial<ToolPart>) => void;
  commitCurrentMessage: (convId: string) => void;
  finalizeStream: (convId: string) => void;
  cancelStream: (convId: string) => void;
  setAgentReady: (convId: string) => void;
  getConv: (convId: string) => ConvState | undefined;
  replaceWithSummary: (convId: string, summaryMsg: Message) => void;
  setTokenCount: (convId: string, count: number) => void;
  addMessage: (convId: string, msg: UIMessage) => void;
}
const defaultConv = (workspaceId: string | null): ConvState => ({ messages: [], currentMessage: null, isStreaming: false, tokenCount: 0, workspaceId, agentReady: false });
function upd(convs: Record<string, ConvState>, id: string, fn: (c: ConvState) => ConvState): Record<string, ConvState> {
  const c = convs[id]; if (!c) return convs; return { ...convs, [id]: fn(c) };
}
export const useConversationsStore = create<ConversationsStore>((set, get) => ({
  convs: {}, activeConvId: null,
  setActiveConv: (id) => set({ activeConvId: id }),
  initConv: (convId, workspaceId, messages) => set(s => ({ convs: { ...s.convs, [convId]: { ...defaultConv(workspaceId), messages, agentReady: s.convs[convId]?.agentReady || false } } })),
  removeConv: (convId) => set(s => { const { [convId]: _, ...rest } = s.convs; return { convs: rest, activeConvId: s.activeConvId === convId ? null : s.activeConvId }; }),
  startIteration: (convId, messageId) => set(s => ({
    convs: upd(s.convs, convId, c => {
      const msgs = c.currentMessage ? [...c.messages, c.currentMessage] : c.messages;
      return { ...c, messages: msgs, currentMessage: { id: messageId, convId, role: 'assistant', parts: [], createdAt: Date.now() }, isStreaming: true };
    })
  })),
  appendChunk: (convId, delta, tokenCount, messageId) => set(s => ({
    convs: upd(s.convs, convId, c => {
      let cur = c.currentMessage ?? { id: messageId, convId, role: 'assistant' as const, parts: [], createdAt: Date.now() };
      const parts = [...cur.parts];
      const last = parts[parts.length - 1];
      if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + delta };
      else parts.push({ type: 'text', text: delta });
      const liveCount = tokenCount + Math.ceil(parts.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 0), 0) / 4);
      return { ...c, currentMessage: { ...cur, parts }, isStreaming: true, tokenCount: liveCount };
    })
  })),
  addToolCall: (convId, tc) => set(s => ({
    convs: upd(s.convs, convId, c => {
      const cur = c.currentMessage ?? { id: `tc-${Date.now()}`, convId, role: 'assistant' as const, parts: [], createdAt: Date.now() };
      const part: ToolPart = { type: 'tool-call', id: tc.id, name: tc.name, input: tc.input };
      return { ...c, currentMessage: { ...cur, parts: [...cur.parts, part] } };
    })
  })),
  updateToolCall: (convId, tcId, patch) => set(s => ({
    convs: upd(s.convs, convId, c => {
      const up = (msg: UIMessage): UIMessage => ({ ...msg, parts: msg.parts.map(p => p.type === 'tool-call' && p.id === tcId ? { ...p, ...patch } : p) });
      return { ...c, currentMessage: c.currentMessage ? up(c.currentMessage) : null, messages: c.messages.map(up) };
    })
  })),
  commitCurrentMessage: (convId) => set(s => ({ convs: upd(s.convs, convId, c => c.currentMessage ? { ...c, messages: [...c.messages, c.currentMessage], currentMessage: null } : c) })),
  finalizeStream: (convId) => set(s => ({ convs: upd(s.convs, convId, c => { const msgs = c.currentMessage ? [...c.messages, c.currentMessage] : c.messages; return { ...c, messages: msgs, currentMessage: null, isStreaming: false }; }) })),
  cancelStream: (convId) => set(s => ({ convs: upd(s.convs, convId, c => { const msgs = c.currentMessage ? [...c.messages, c.currentMessage] : c.messages; return { ...c, messages: msgs, currentMessage: null, isStreaming: false, agentReady: false }; }) })),
  setAgentReady: (convId) => set(s => ({ convs: { ...s.convs, [convId]: { ...(s.convs[convId] || defaultConv(null)), agentReady: true } } })),
  getConv: (convId) => get().convs[convId],
  replaceWithSummary: (convId, summaryMsg) => set(s => ({
    convs: upd(s.convs, convId, c => {
      const summaryUI: UIMessage = { id: summaryMsg.id, convId, role: 'system', parts: [{ type: 'text', text: summaryMsg.content }], createdAt: summaryMsg.createdAt };
      return { ...c, messages: [summaryUI, ...c.messages.slice(-10)], currentMessage: null };
    })
  })),
  setTokenCount: (convId, count) => set(s => ({ convs: upd(s.convs, convId, c => ({ ...c, tokenCount: count })) })),
  addMessage: (convId, msg) => set(s => ({ convs: upd(s.convs, convId, c => ({ ...c, messages: [...c.messages, msg], isStreaming: true, currentMessage: null })) })),
}));
