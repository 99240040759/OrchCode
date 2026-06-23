import { create } from 'zustand';
import type { Workspace, Conversation } from '../ipc/types';
interface WorkspacesStore {
  workspaces: Workspace[];
  homeConversations: Conversation[];
  wsConversations: Map<string, Conversation[]>;
  setWorkspaces: (ws: Workspace[]) => void;
  addWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => void;
  setHomeConversations: (convs: Conversation[]) => void;
  setWsConversations: (wsId: string, convs: Conversation[]) => void;
  addConversation: (conv: Conversation) => void;
  removeConversation: (convId: string, wsId: string | null) => void;
  updateConversationTitle: (convId: string, title: string) => void;
}
export const useWorkspacesStore = create<WorkspacesStore>((set) => ({
  workspaces: [],
  homeConversations: [],
  wsConversations: new Map(),
  setWorkspaces: (ws) => set({ workspaces: ws }),
  addWorkspace: (ws) => set(s => ({ workspaces: [...s.workspaces, ws] })),
  removeWorkspace: (id) => set(s => {
    const m = new Map(s.wsConversations);
    m.delete(id);
    return { workspaces: s.workspaces.filter(w => w.id !== id), wsConversations: m };
  }),
  setHomeConversations: (convs) => set({ homeConversations: convs }),
  setWsConversations: (wsId, convs) => set(s => { const m = new Map(s.wsConversations); m.set(wsId, convs); return { wsConversations: m }; }),
  addConversation: (conv) => {
    if (!conv.workspaceId) set(s => ({ homeConversations: [conv, ...s.homeConversations] }));
    else set(s => { const m = new Map(s.wsConversations); const cur = m.get(conv.workspaceId!) || []; m.set(conv.workspaceId!, [conv, ...cur]); return { wsConversations: m }; });
  },
  removeConversation: (convId, wsId) => {
    if (!wsId) set(s => ({ homeConversations: s.homeConversations.filter(c => c.id !== convId) }));
    else set(s => { const m = new Map(s.wsConversations); m.set(wsId, (m.get(wsId) || []).filter(c => c.id !== convId)); return { wsConversations: m }; });
  },
  updateConversationTitle: (convId, title) => set(s => {
    const updateList = (list: Conversation[]) => list.map(c => c.id === convId ? { ...c, title } : c);
    const home = updateList(s.homeConversations);
    const m = new Map(s.wsConversations);
    for (const [wsId, convs] of m) m.set(wsId, updateList(convs));
    return { homeConversations: home, wsConversations: m };
  }),
}));
