import { create } from 'zustand';
export interface OpenTab { id: string; type: 'viewer' | 'diff'; path: string; title: string; content?: string; original?: string; modified?: string; startLine?: number; endLine?: number; }
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
  openFileViewer: (convId, path, content, startLine, endLine) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => {
      const tabId = `viewer:${path}`, filename = path.split('/').pop() || path;
      const exists = cur.openTabs.some(t => t.id === tabId);
      return { ...cur, artifactOpen: true, activeTabId: tabId, openTabs: exists ? cur.openTabs : [...cur.openTabs, { id: tabId, type: 'viewer', path, title: filename, content, startLine, endLine }] };
    })
  })),
  openFileDiff: (convId, path, original, modified) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => {
      const tabId = `diff:${path}`, filename = path.split('/').pop() || path;
      const exists = cur.openTabs.some(t => t.id === tabId);
      return { ...cur, artifactOpen: true, activeTabId: tabId, openTabs: exists ? cur.openTabs : [...cur.openTabs, { id: tabId, type: 'diff', path, title: `Diff: ${filename}`, original, modified }] };
    })
  })),
  openImageViewer: (convId, label, dataUrl) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => {
      const tabId = `viewer:image:${label}`;
      const exists = cur.openTabs.some(t => t.id === tabId);
      return { ...cur, artifactOpen: true, activeTabId: tabId, openTabs: exists ? cur.openTabs : [...cur.openTabs, { id: tabId, type: 'viewer', path: label, title: label, content: dataUrl }] };
    })
  })),
  setActiveTabId: (convId, id) => set(s => ({ convUI: updUI(s.convUI, convId, c => ({ ...c, activeTabId: id })) })),
  closeTab: (convId, id) => set(s => ({
    convUI: updUI(s.convUI, convId, cur => {
      const openTabs = cur.openTabs.filter(t => t.id !== id);
      return { ...cur, openTabs, activeTabId: cur.activeTabId === id ? (openTabs.at(-1)?.id ?? 'browser') : cur.activeTabId };
    })
  })),
  removeConvUI: (convId) => set(s => { const { [convId]: _, ...rest } = s.convUI; return { convUI: rest }; }),
}));
