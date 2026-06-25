import { create } from 'zustand';
export interface OpenTab { id: string; type: 'file' | 'image'; path: string; title: string; content?: string; original?: string; modified?: string; viewMode?: 'viewer' | 'diff'; startLine?: number; endLine?: number; }
export interface PerConvUI { activeTabId: string; openTabs: OpenTab[]; artifactOpen: boolean; artifactMaximized: boolean; }
interface UIStore {
  sidebarOpen: boolean;
  convUI: Record<string, PerConvUI>;
  setSidebarOpen: (v: boolean) => void;
  getConvUI: (convId: string) => PerConvUI;
  setArtifactOpen: (convId: string, v: boolean) => void;
  setArtifactMaximized: (convId: string, v: boolean) => void;
  openFileViewer: (convId: string, path: string, content: string, startLine: number, endLine: number) => void;
  openFileDiff: (convId: string, path: string, original: string, modified: string) => void;
  openImageViewer: (convId: string, label: string, dataUrl: string) => void;
  setActiveTabId: (convId: string, id: string) => void;
  toggleTabViewMode: (convId: string, tabId: string) => void;
  closeTab: (convId: string, id: string) => void;
  removeConvUI: (convId: string) => void;
}
export const makeDefaultConvUI = (): PerConvUI => ({ activeTabId: 'browser', openTabs: [], artifactOpen: false, artifactMaximized: false });
export const DEFAULT_CONV_UI = Object.freeze({ activeTabId: 'browser', openTabs: Object.freeze([]) as any, artifactOpen: false, artifactMaximized: false });
function updUI(convUI: Record<string, PerConvUI>, id: string, fn: (c: PerConvUI) => PerConvUI): Record<string, PerConvUI> {
  return { ...convUI, [id]: fn(convUI[id] || makeDefaultConvUI()) };
}
export const useUIStore = create<UIStore>((set, get) => ({
  sidebarOpen: true,
  convUI: {},
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  getConvUI: (convId) => get().convUI[convId] || makeDefaultConvUI(),
  setArtifactOpen: (convId, v) => set(s => ({ convUI: updUI(s.convUI, convId, c => ({ ...c, artifactOpen: v })) })),
  setArtifactMaximized: (convId, v) => set(s => ({ convUI: updUI(s.convUI, convId, c => ({ ...c, artifactMaximized: v })) })),
  openFileViewer: (convId: string, path: string, content: string, startLine: number, endLine: number) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => {
      const tabId = `file:${path}`, filename = path.split('/').pop() || path;
      const exists = cur.openTabs.some(t => t.id === tabId);
      const openTabs = exists ? cur.openTabs.map(t => t.id === tabId ? { ...t, content, startLine, endLine, viewMode: 'viewer' as const } : t) : [...cur.openTabs, { id: tabId, type: 'file' as const, path, title: filename, content, viewMode: 'viewer' as const, startLine, endLine }];
      return { ...cur, artifactOpen: true, activeTabId: tabId, openTabs };
    })
  })),
  openFileDiff: (convId: string, path: string, original: string, modified: string) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => {
      const tabId = `file:${path}`, filename = path.split('/').pop() || path;
      const exists = cur.openTabs.some(t => t.id === tabId);
      const openTabs = exists ? cur.openTabs.map(t => t.id === tabId ? { ...t, original, modified, viewMode: 'diff' as const } : t) : [...cur.openTabs, { id: tabId, type: 'file' as const, path, title: filename, original, modified, viewMode: 'diff' as const }];
      return { ...cur, artifactOpen: true, activeTabId: tabId, openTabs };
    })
  })),
  openImageViewer: (convId, label, dataUrl) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => {
      const tabId = `viewer:image:${label}`;
      const exists = cur.openTabs.some(t => t.id === tabId);
      return { ...cur, artifactOpen: true, activeTabId: tabId, openTabs: exists ? cur.openTabs : [...cur.openTabs, { id: tabId, type: 'image' as const, path: label, title: label, content: dataUrl }] };
    })
  })),
  setActiveTabId: (convId, id) => set(s => ({ convUI: updUI(s.convUI, convId, c => ({ ...c, activeTabId: id })) })),
  toggleTabViewMode: (convId, tabId) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => ({
      ...cur,
      openTabs: cur.openTabs.map(t => t.id === tabId ? { ...t, viewMode: t.viewMode === 'diff' ? 'viewer' : 'diff' } : t)
    }))
  })),
  closeTab: (convId, id) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => {
      const openTabs = cur.openTabs.filter(t => t.id !== id);
      return { ...cur, openTabs, activeTabId: cur.activeTabId === id ? (openTabs.at(-1)?.id ?? 'browser') : cur.activeTabId };
    })
  })),
  removeConvUI: (convId) => set(s => { const { [convId]: _, ...rest } = s.convUI; return { convUI: rest }; }),
}));
