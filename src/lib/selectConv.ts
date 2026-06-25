import { el } from './electron';
import { useConversationsStore } from '@/store/conversations';
export async function selectConv(convId: string, workspaceId: string | null) {
  const { setActiveConv, convs, initConv } = useConversationsStore.getState();
  setActiveConv(convId);
  const existing = convs[convId];
  if (!existing || existing.status === 'idle') {
    const messages = await el.loadConversation(convId);
    initConv(convId, workspaceId, messages);
  }
}
