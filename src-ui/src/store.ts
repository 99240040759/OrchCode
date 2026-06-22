import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { UserProfile, ModelInfo } from './api';
// ═══════════════════════════════════════════════════════════════════════════════
// BACKEND-DRIVEN STATE — single source of truth from Rust AppStateManager
// ═══════════════════════════════════════════════════════════════════════════════
export type WorkspaceMeta = { id: string; path: string; name: string };
export type ThreadInfo = { id: string; title?: string; resource_id: string; workspace_path?: string; created_at: string; updated_at: string };
export type ActiveWorkspace = { id: string; path: string; name: string; threads: ThreadInfo[]; activeThreadId: string | null };
export type AppSnapshot = { workspaces: WorkspaceMeta[]; active: ActiveWorkspace | null; threadTokens: Record<string, [number, number]> };
const [state, setState] = createStore<AppSnapshot>({ workspaces: [], active: null, threadTokens: {} });
export { state as appState };
export const setAppState = (snap: AppSnapshot) => setState(reconcile(snap));
// ── Derived accessors ──
export const workspaces = () => state.workspaces;
export const activeWorkspace = () => state.active;
export const workspacePath = () => state.active?.path ?? null;
export const threads = () => state.active?.threads ?? [];
export const activeThreadId = () => state.active?.activeThreadId ?? null;
export const activeThread = () => {
  const ws = state.active;
  if (!ws?.activeThreadId) return null;
  return ws.threads.find(t => t.id === ws.activeThreadId) ?? null;
};
// ═══════════════════════════════════════════════════════════════════════════════
// UI-ONLY STATE
// ═══════════════════════════════════════════════════════════════════════════════
export const [user, setUser] = createSignal<UserProfile | null>(null);
export const [authLoading, setAuthLoading] = createSignal(true);
export const [isDark, setIsDark] = createSignal(true);
export const [models, setModels] = createSignal<ModelInfo[]>([]);
export const [selectedModel, setSelectedModel] = createSignal('');
export const [isStreaming, setIsStreaming] = createSignal(false);
export type ArtifactTab = 'terminal' | 'explorer';
export const [artifactTab, setArtifactTab] = createSignal<ArtifactTab>('terminal');
export const [filesSidebarOpen, setFilesSidebarOpen] = createSignal(true);
export const [fileToOpen, setFileToOpen] = createSignal<string | null>(null);
