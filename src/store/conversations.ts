import { create } from 'zustand';
import type { UIMessage, UIPart, UIToolPart, AgentEvent } from '../ipc/types';
export type ConvStatus = 'idle' | 'busy' | 'error';
export interface ConvState { messages: UIMessage[]; status: ConvStatus; tokenCount: number; workspaceId: string | null; }
interface Store {
  convs: Record<string, ConvState>;
  activeConvId: string | null;
  setActiveConv: (id: string | null) => void;
  initConv: (convId: string, workspaceId: string | null, messages: UIMessage[]) => void;
  removeConv: (convId: string) => void;
  getConv: (convId: string) => ConvState | undefined;
  addUserMessage: (convId: string, msg: UIMessage) => void;
  appendDelta: (convId: string, messageId: string, partId: string, text: string) => void;
  apply: (convId: string, ev: AgentEvent) => void;
  setTokenCount: (convId: string, n: number) => void;
}
const def = (workspaceId: string | null): ConvState => ({ messages: [], status: 'idle', tokenCount: 0, workspaceId });
const upd = (convs: Record<string, ConvState>, id: string, fn: (c: ConvState) => ConvState) => { const c = convs[id]; return c ? { ...convs, [id]: fn(c) } : convs; };
const patchMsg = (msgs: UIMessage[], id: string, fn: (m: UIMessage) => UIMessage) => msgs.map(m => m.id === id ? fn(m) : m);
const addPart = (m: UIMessage, p: UIPart): UIMessage => ({ ...m, parts: [...m.parts, p] });
export const useConversationsStore = create<Store>((set, get) => ({
  convs: {}, activeConvId: null,
  setActiveConv: (id) => set({ activeConvId: id }),
  initConv: (convId, workspaceId, messages) => set(s => ({ convs: { ...s.convs, [convId]: { ...def(workspaceId), messages } } })),
  removeConv: (convId) => set(s => { const { [convId]: _, ...rest } = s.convs; return { convs: rest, activeConvId: s.activeConvId === convId ? null : s.activeConvId }; }),
  getConv: (convId) => get().convs[convId],
  addUserMessage: (convId, msg) => set(s => ({ convs: { ...s.convs, [convId]: { ...(s.convs[convId] || def(null)), messages: [...(s.convs[convId]?.messages || []), msg], status: 'busy' } } })),
  appendDelta: (convId, messageId, partId, text) => set(s => ({ convs: upd(s.convs, convId, c => ({ ...c, messages: patchMsg(c.messages, messageId, m => ({ ...m, parts: m.parts.map(p => p.id === partId && (p.type === 'text' || p.type === 'reasoning') ? { ...p, text: p.text + text } : p) })) })) })),
  setTokenCount: (convId, n) => set(s => ({ convs: upd(s.convs, convId, c => ({ ...c, tokenCount: n })) })),
  apply: (convId, ev) => set(s => {
    const existing = s.convs[convId];
    
    if (!existing && ev.type !== 'message.start') return s;
    const c = existing || def(null);
    const reduce = (c: ConvState): ConvState => {
    switch (ev.type) {
      case 'message.start': return { ...c, status: 'busy', messages: [...c.messages, { id: ev.message.id, convId, role: 'assistant', status: 'streaming', parts: [], createdAt: ev.message.createdAt }] };
      case 'part.start': {
        const p: UIPart = ev.part.type === 'tool'
          ? { type: 'tool', id: ev.part.id, toolCallId: ev.part.toolCallId!, name: ev.part.toolName!, args: ev.part.toolArgs || '{}', status: 'running' }
          : { type: ev.part.type as 'text' | 'reasoning', id: ev.part.id, text: '' };
        return { ...c, messages: patchMsg(c.messages, ev.part.messageId, m => addPart(m, p)) };
      }
      case 'part.image': return { ...c, messages: patchMsg(c.messages, ev.messageId, m => addPart(m, { type: 'image', id: ev.partId, artifactId: null, mime: ev.mime, name: ev.name, dataUrl: ev.dataUrl })) };
      case 'tool.update': return { ...c, messages: patchMsg(c.messages, ev.messageId, m => ({ ...m, parts: m.parts.map(p => p.type === 'tool' && p.id === ev.partId ? { ...p, status: ev.status, result: ev.result ?? p.result, meta: ev.meta ?? (p as UIToolPart).meta } : p) })) };
      case 'message.end': return { ...c, status: ev.status === 'error' ? 'error' : 'idle', messages: patchMsg(c.messages, ev.messageId, m => ({ ...m, status: ev.status, error: ev.error })) };
      case 'compacted': {
        const summary: UIMessage = { id: ev.summaryMessage.id, convId, role: 'system', status: 'complete', parts: [{ type: 'text', id: ev.summaryPart.id, text: ev.summaryPart.text || '' }], createdAt: ev.summaryMessage.createdAt };
        const last = c.messages[c.messages.length - 1];
        const insertAt = last?.status === 'streaming' ? c.messages.length - 1 : c.messages.length;
        return { ...c, messages: [...c.messages.slice(0, insertAt), summary, ...c.messages.slice(insertAt)] };
      }
      default: return c;
    }
    };
    return { convs: { ...s.convs, [convId]: reduce(c) } };
  }),
}));
