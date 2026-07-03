import { nanoid } from 'nanoid';
import { el } from './electron';
import { toast } from 'sonner';
import type { InputPart } from '../preload';
import { useConversationsStore } from '@/store/conversations';
import { useAuthStore } from '@/store/auth';
import { useModelsStore } from '@/store/models';
import type { UIMessage, UIPart, AgentRunConfig } from '@/ipc/types';
export type EditorPart = { type: 'text'; text: string } | { type: 'mention'; path: string };
export type Attachment = { name: string; dataUrl: string; mimeType: string };
let cachedDataPath: string | null = null;
const dataPath = async () => (cachedDataPath ??= await el.getUserDataPath());
export async function sendMessage(convId: string, workspacePath: string | null, editorParts: EditorPart[], attachments: Attachment[] = []) {
  if (useConversationsStore.getState().convs[convId]?.status === 'busy') return; 
  const { accessToken } = useAuthStore.getState();
  const model = useModelsStore.getState().selectedModel();
  if (!accessToken || !model) return;
  const allowImages = model.multimodal;
  
  const inputParts: InputPart[] = [];
  const uiParts: UIPart[] = [];
  for (const p of editorParts) {
    if (p.type === 'text' && p.text.trim()) { inputParts.push({ type: 'text', text: p.text }); uiParts.push({ type: 'text', id: nanoid(), text: p.text }); }
    else if (p.type === 'mention') { inputParts.push({ type: 'mention', path: p.path }); uiParts.push({ type: 'mention', id: nanoid(), path: p.path }); }
  }
  for (const a of attachments) {
    const isImg = a.mimeType.startsWith('image/');
    if (isImg && !allowImages) { toast.warning(`${a.name} skipped — ${model.name} can't read images`); continue; }
    const kind = isImg ? 'image' : 'file';
    inputParts.push({ type: kind, name: a.name, mime: a.mimeType, dataUrl: a.dataUrl });
    uiParts.push(kind === 'image' ? { type: 'image', id: nanoid(), artifactId: null, mime: a.mimeType, name: a.name, dataUrl: a.dataUrl } : { type: 'file', id: nanoid(), artifactId: null, name: a.name, mime: a.mimeType });
  }
  if (!inputParts.length) return;
  const id = nanoid();
  const userMsg: UIMessage = { id, convId, role: 'user', status: 'complete', parts: uiParts, createdAt: Date.now() };
  useConversationsStore.getState().addUserMessage(convId, userMsg);
  const sessionDir = `${await dataPath()}/sessions/${convId}`;
  const config: AgentRunConfig = {
    convId, workspacePath, sessionDir, jwt: accessToken, anonKey: el.anonKey, gcpBase: el.gcpBase,
    modelId: model.id, provider: model.provider, contextWindow: model.contextWindow, reasoningEffort: model.reasoningEffort,
  };
  try {
    const res = await el.agentSend(config, { id, parts: inputParts });
    if (!res.ok) {
      useConversationsStore.setState(s => ({ convs: { ...s.convs, [convId]: { ...s.convs[convId], status: 'idle' } } }));
      if (res.busy) toast.warning('Agent is busy — stop the current run first');
    }
  } catch (err: any) {
    useConversationsStore.setState(s => ({ convs: { ...s.convs, [convId]: { ...s.convs[convId], status: 'idle' } } }));
    toast.error(`Failed to send message: ${err.message || err}`);
  }
}
export function stopAgent(convId: string) { el.agentAbort(convId); }
