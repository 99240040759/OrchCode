import { useConversationsStore } from '@/store/conversations';
type Buf = { convId: string; messageId: string; partId: string; text: string };
const buffers = new Map<string, Buf>();
let raf = 0;
function tick() {
  if (buffers.size) { const store = useConversationsStore.getState(); for (const b of buffers.values()) if (b.text) { store.appendDelta(b.convId, b.messageId, b.partId, b.text); b.text = ''; } }
  raf = requestAnimationFrame(tick);
}
export function startFlusher() { if (!raf) raf = requestAnimationFrame(tick); }
export function pushDelta(convId: string, messageId: string, partId: string, text: string) {
  const k = convId + '|' + partId, b = buffers.get(k);
  if (b) b.text += text; else buffers.set(k, { convId, messageId, partId, text });
}
