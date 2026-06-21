import { createSignal } from 'solid-js';
import type { UserProfile, ModelInfo } from './api';
// ═══════════════════════════════════════════════════════════════════════════════
// BACKEND-DRIVEN STATE — single source of truth from Rust AppStateManager
// ═══════════════════════════════════════════════════════════════════════════════
export type WorkspaceMeta = { id: string; path: string; name: string };
export type ThreadInfo = { id: string; title?: string; resource_id: string; workspace_path?: string; created_at: string; updated_at: string };
export type ActiveWorkspace = { id: string; path: string; name: string; threads: ThreadInfo[]; activeThreadId: string | null };
export type AppSnapshot = { workspaces: WorkspaceMeta[]; active: ActiveWorkspace | null; threadTokens: Record<string, [number, number]> };
const [appState, setAppState] = createSignal<AppSnapshot>({ workspaces: [], active: null, threadTokens: {} });
export { appState, setAppState };
// ── Derived accessors — ALL from appState, ZERO independent signals ──
export const workspaces = () => appState().workspaces;
export const activeWorkspace = () => appState().active;
export const workspacePath = () => appState().active?.path ?? null;
export const threads = () => appState().active?.threads ?? [];
export const activeThreadId = () => appState().active?.activeThreadId ?? null;
export const activeThread = () => {
  const ws = appState().active;
  if (!ws?.activeThreadId) return null;
  return ws.threads.find(t => t.id === ws.activeThreadId) ?? null;
};
// ═══════════════════════════════════════════════════════════════════════════════
// UI-ONLY STATE — not backend-driven, purely frontend concerns
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
export const [workspaceFiles, setWorkspaceFiles] = createSignal<string[]>([]);
