import { el } from './electron';
import { useConversationsStore } from '@/store/conversations';
export async function selectConv(convId: string, workspaceId: string | null) {
  const { setActiveConv, convs, initConv, setTokenCount } = useConversationsStore.getState();
  setActiveConv(convId);
  const existing = convs[convId];
  if (!existing || (existing.status !== 'busy' && existing.messages.length === 0)) {
    const messages = await el.loadConversation(convId);
    initConv(convId, workspaceId, messages);
    // initConv resets tokenCount to 0 — rehydrate the context-usage ring from the last persisted prompt size.
    const tokens = await el.getContextTokens(convId).catch(() => 0);
    if (tokens) setTokenCount(convId, tokens);
  }
}
