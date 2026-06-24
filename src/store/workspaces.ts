import { create } from 'zustand';
import type { Workspace, Conversation } from '../ipc/types';
interface WorkspacesStore {
  workspaces: Workspace[]; homeConversations: Conversation[]; wsConversations: Record<string, Conversation[]>;
  setWorkspaces: (ws: Workspace[]) => void; addWorkspace: (ws: Workspace) => void; removeWorkspace: (id: string) => void;
  setHomeConversations: (convs: Conversation[]) => void; setWsConversations: (wsId: string, convs: Conversation[]) => void;
  addConversation: (conv: Conversation) => void; removeConversation: (convId: string, wsId: string | null) => void;
  updateConversationTitle: (convId: string, title: string) => void;
}
export const useWorkspacesStore = create<WorkspacesStore>((set) => ({
  workspaces: [], homeConversations: [], wsConversations: {},
  setWorkspaces: (ws) => set({ workspaces: ws }),
  addWorkspace: (ws) => set(s => ({ workspaces: [...s.workspaces, ws] })),
  removeWorkspace: (id) => set(s => { const { [id]: _, ...rest } = s.wsConversations; return { workspaces: s.workspaces.filter(w => w.id !== id), wsConversations: rest }; }),
  setHomeConversations: (convs) => set({ homeConversations: convs }),
  setWsConversations: (wsId, convs) => set(s => ({ wsConversations: { ...s.wsConversations, [wsId]: convs } })),
  addConversation: (conv) => {
    if (!conv.workspaceId) set(s => ({ homeConversations: [conv, ...s.homeConversations] }));
    else set(s => ({ wsConversations: { ...s.wsConversations, [conv.workspaceId!]: [conv, ...(s.wsConversations[conv.workspaceId!] || [])] } }));
  },
  removeConversation: (convId, wsId) => {
    if (!wsId) set(s => ({ homeConversations: s.homeConversations.filter(c => c.id !== convId) }));
    else set(s => ({ wsConversations: { ...s.wsConversations, [wsId]: (s.wsConversations[wsId] || []).filter(c => c.id !== convId) } }));
  },
  updateConversationTitle: (convId, title) => set(s => {
    const upd = (list: Conversation[]) => list.map(c => c.id === convId ? { ...c, title } : c);
    const wsConversations: Record<string, Conversation[]> = {};
    for (const [id, convs] of Object.entries(s.wsConversations)) wsConversations[id] = upd(convs);
    return { homeConversations: upd(s.homeConversations), wsConversations };
  }),
}));
