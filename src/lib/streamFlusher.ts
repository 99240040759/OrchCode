import { useConversationsStore } from '@/store/conversations';
type Buf = { delta: string; tokenCount: number; messageId: string };
const buffers: Record<string, Buf> = {};
const rafIds: Record<string, number> = {};
export function pushChunk(convId: string, delta: string, tokenCount: number, messageId: string) {
  const b = buffers[convId];
  if (b) { b.delta += delta; b.tokenCount = tokenCount; b.messageId = messageId; }
  else buffers[convId] = { delta, tokenCount, messageId };
}
export function registerFlusher(convId: string): () => void {
  const tick = () => {
    const b = buffers[convId];
    if (b?.delta) { useConversationsStore.getState().appendChunk(convId, b.delta, b.tokenCount, b.messageId); b.delta = ''; }
    rafIds[convId] = requestAnimationFrame(tick);
  };
  rafIds[convId] = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(rafIds[convId]); delete rafIds[convId]; delete buffers[convId]; };
}
export function stopFlusher(convId: string) {
  if (rafIds[convId]) { cancelAnimationFrame(rafIds[convId]); delete rafIds[convId]; }
  delete buffers[convId];
}
