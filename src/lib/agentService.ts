import { nanoid } from 'nanoid';
import { el } from './electron';
import { useConversationsStore } from '@/store/conversations';
import { useAuthStore } from '@/store/auth';
import { useModelsStore } from '@/store/models';
import type { UIMessage } from '@/ipc/types';
let cachedUserDataPath: string | null = null;
const getDataPath = async () => { if (!cachedUserDataPath) cachedUserDataPath = await el.getUserDataPath(); return cachedUserDataPath; };
export async function sendMessage(convId: string, workspacePath: string | null, text: string, attachments?: Array<{ name: string; dataUrl: string; mimeType: string }>) {
  const { accessToken } = useAuthStore.getState();
  const { models, selectedKey } = useModelsStore.getState();
  const selectedModel = models[selectedKey] ?? null;
  if (!accessToken || !selectedModel) return;
  let content: any = text;
  if (attachments?.length && selectedModel.multimodal) {
    const parts: any[] = [];
    if (text.trim()) parts.push({ type: 'text', text: text.trim() });
    for (const a of attachments) {
      if (a.mimeType.startsWith('image/')) parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      else parts.push({ type: 'text', text: `[Attached file: ${a.name}]` });
    }
    content = parts;
  }
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  const historySnapshot = useConversationsStore.getState().convs[convId]?.messages || [];
  const userMsg: UIMessage = { id: nanoid(), convId, role: 'user', parts: [{ type: 'text', text: contentStr }], createdAt: Date.now() };
  useConversationsStore.getState().addMessage(convId, userMsg);
  el.writeMessage({ id: userMsg.id, convId, role: 'user', content: contentStr, tokenCount: 0, createdAt: userMsg.createdAt });
  const userDataPath = await getDataPath();
  const history = historySnapshot.flatMap(m => m.parts
    .filter(p => p.type === 'text' && m.role !== 'system')
    .map(p => ({ id: m.id, convId, role: m.role as any, content: (p as any).text, tokenCount: 0, createdAt: m.createdAt }))
  );
  const agentConfig = {
    convId, workspacePath, sessionDir: `${userDataPath}/sessions/${convId}`, history,
    jwt: accessToken, anonKey: el.anonKey, gcpBase: el.gcpBase,
    modelId: selectedModel.id, provider: selectedModel.provider,
    contextWindow: selectedModel.contextWindow, reasoningEffort: selectedModel.reasoningEffort,
  };
  const agentReady = useConversationsStore.getState().convs[convId]?.agentReady;
  if (!agentReady) el.spawnAgent(agentConfig);
  el.sendToAgent(convId, { type: 'send', content: contentStr });
}
export function stopAgent(convId: string) {
  el.killAgent(convId);
  useConversationsStore.getState().cancelStream(convId);
  el.removeAgentPort(convId);
}
