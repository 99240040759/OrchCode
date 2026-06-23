import { create } from 'zustand';
export interface OpenTab {
  id: string;
  type: 'viewer' | 'diff';
  path: string;
  title: string;
  content?: string;
  original?: string;
  modified?: string;
  startLine?: number;
  endLine?: number;
}
interface PerConvUI { activeTabId: string; openTabs: OpenTab[]; }
interface UIStore {
  sidebarOpen: boolean;
  artifactOpen: boolean;
  artifactMaximized: boolean;
  convUI: Map<string, PerConvUI>;
  setSidebarOpen: (v: boolean) => void;
  setArtifactOpen: (v: boolean) => void;
  setArtifactMaximized: (v: boolean) => void;
  getConvUI: (convId: string) => PerConvUI;
  openFileViewer: (convId: string, path: string, content: string, startLine: number, endLine: number) => void;
  openFileDiff: (convId: string, path: string, original: string, modified: string) => void;
  openImageViewer: (convId: string, label: string, dataUrl: string) => void;
  setActiveTabId: (convId: string, id: string) => void;
  closeTab: (convId: string, id: string) => void;
  removeConvUI: (convId: string) => void;
}
const defaultUI = (): PerConvUI => ({ activeTabId: 'browser', openTabs: [] });
export const useUIStore = create<UIStore>((set, get) => ({
  sidebarOpen: true,
  artifactOpen: false,
  artifactMaximized: false,
  convUI: new Map(),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setArtifactOpen: (v) => set({ artifactOpen: v }),
  setArtifactMaximized: (v) => set({ artifactMaximized: v }),
  getConvUI: (convId) => get().convUI.get(convId) || defaultUI(),
  openFileViewer: (convId, path, content, startLine, endLine) => set(s => {
    const m = new Map(s.convUI);
    const cur = m.get(convId) || defaultUI();
    const filename = path.split('/').pop() || path, tabId = `viewer:${path}`;
    const exists = cur.openTabs.some(t => t.id === tabId);
    m.set(convId, { activeTabId: tabId, openTabs: exists ? cur.openTabs : [...cur.openTabs, { id: tabId, type: 'viewer', path, title: filename, content, startLine, endLine }] });
    return { artifactOpen: true, convUI: m };
  }),
  openFileDiff: (convId, path, original, modified) => set(s => {
    const m = new Map(s.convUI);
    const cur = m.get(convId) || defaultUI();
    const filename = path.split('/').pop() || path, tabId = `diff:${path}`;
    const exists = cur.openTabs.some(t => t.id === tabId);
    m.set(convId, { activeTabId: tabId, openTabs: exists ? cur.openTabs : [...cur.openTabs, { id: tabId, type: 'diff', path, title: `Diff: ${filename}`, original, modified }] });
    return { artifactOpen: true, convUI: m };
  }),
  openImageViewer: (convId, label, dataUrl) => set(s => {
    const m = new Map(s.convUI);
    const cur = m.get(convId) || defaultUI();
    const tabId = `viewer:image:${label}`;
    const exists = cur.openTabs.some(t => t.id === tabId);
    m.set(convId, { activeTabId: tabId, openTabs: exists ? cur.openTabs : [...cur.openTabs, { id: tabId, type: 'viewer', path: label, title: label, content: dataUrl }] });
    return { artifactOpen: true, convUI: m };
  }),
  setActiveTabId: (convId, id) => set(s => {
    const m = new Map(s.convUI);
    const cur = m.get(convId) || defaultUI();
    m.set(convId, { ...cur, activeTabId: id });
    return { convUI: m };
  }),
  closeTab: (convId, id) => set(s => {
    const m = new Map(s.convUI);
    const cur = m.get(convId) || defaultUI();
    const openTabs = cur.openTabs.filter(t => t.id !== id);
    m.set(convId, { openTabs, activeTabId: cur.activeTabId === id ? (openTabs.length > 0 ? openTabs[openTabs.length - 1].id : 'browser') : cur.activeTabId });
    return { convUI: m };
  }),
  removeConvUI: (convId) => set(s => { const m = new Map(s.convUI); m.delete(convId); return { convUI: m }; }),
}));
