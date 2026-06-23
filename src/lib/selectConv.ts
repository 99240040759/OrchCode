import { el } from './electron';
import { useConversationsStore } from '@/store/conversations';
export async function selectConv(convId: string, workspaceId: string | null) {
  const { setActiveConv, convs, initConv } = useConversationsStore.getState();
  setActiveConv(convId);
  const existing = convs.get(convId);
  if (!existing || !existing.isStreaming) {
    const messages = await el.loadConversation(convId);
    initConv(convId, workspaceId, messages);
  }
}
