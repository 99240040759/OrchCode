import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Channel } from '@tauri-apps/api/core';
import type { AppSnapshot } from './store';
export type UserProfile = { id: string; email: string; name?: string; avatar_url?: string; onboarding_complete?: boolean };
export type Message = { id: string; role: string; content: string; data?: string; created_at: string };
export type ModelInfo = { id: string; name: string; multimodal: boolean; contextWindow?: number; badge?: string; provider?: string; reasoningEffort?: string };
export type StreamChunk =
  | { type: 'text_delta'; content: string }
  | { type: 'tool_call'; tool_call_id: string; tool_name: string; args: unknown }
  | { type: 'tool_result'; tool_call_id: string; tool_name: string; result: unknown; status: string }
  | { type: 'token_update'; input_tokens: number; output_tokens: number; turn: number }
  | { type: 'summarize'; saved_tokens: number; total_tokens: number }
  | { type: 'finish'; duration_seconds: number }
  | { type: 'error'; message: string };
// ═══════════════════════════════════════════════════════════════════════════════
// STATE — atomic backend-driven operations
// ═══════════════════════════════════════════════════════════════════════════════
export const stateInit = () => invoke<AppSnapshot>('cmd_state_init');
export const stateActivateWorkspace = (path: string) => invoke<AppSnapshot>('cmd_state_activate_workspace', { path });
export const stateOpenWorkspace = (path: string) => invoke<AppSnapshot>('cmd_state_open_workspace', { path });
export const stateCloseWorkspace = (path: string) => invoke<AppSnapshot>('cmd_state_close_workspace', { path });
export const stateSwitchThread = (threadId: string) => invoke<AppSnapshot>('cmd_state_switch_thread', { threadId });
export const stateCreateThread = () => invoke<AppSnapshot>('cmd_state_create_thread');
export const stateDeleteThread = (threadId: string) => invoke<AppSnapshot>('cmd_state_delete_thread', { threadId });
export const stateGenerateTitle = (text: string, threadId: string) => invoke<string | null>('cmd_state_generate_title', { text, threadId });
// ═══════════════════════════════════════════════════════════════════════════════
// DATA QUERIES — stateless
// ═══════════════════════════════════════════════════════════════════════════════
export const threadMessages = (threadId: string) => invoke<Message[]>('cmd_thread_messages', { threadId });
export const workspaceListFilesByPath = (workspacePath: string) => invoke<string[]>('cmd_workspace_list_files_by_path', { workspacePath });
export const fileRead = (filePath: string) => invoke<{ content: string }>('cmd_file_read', { filePath });
export const fileOpen = (filePath: string) => invoke<void>('cmd_file_open', { filePath });
// ═══════════════════════════════════════════════════════════════════════════════
// AGENT — streaming
// ═══════════════════════════════════════════════════════════════════════════════
export const agentStream = (req: { thread_id: string; model_id: string; prompt_text: string; context_window?: number; workspace_path?: string; artifacts_path?: string }, onChunk: (c: StreamChunk) => void) => {
  const ch = new Channel<StreamChunk>();
  ch.onmessage = onChunk;
  return invoke<void>('cmd_agent_stream', { req, channel: ch });
};
export const agentStop = (threadId: string) => invoke<void>('cmd_agent_stop', { threadId });
// ═══════════════════════════════════════════════════════════════════════════════
// TERMINAL / MODELS / AUTH / APP
// ═══════════════════════════════════════════════════════════════════════════════
export const terminalCreate = (id: string, cols: number, rows: number, cwd?: string) => invoke<void>('cmd_terminal_create', { id, cols, rows, cwd });
export const terminalWrite = (id: string, data: string) => invoke<void>('cmd_terminal_write', { id, data });
export const terminalResize = (id: string, cols: number, rows: number) => invoke<void>('cmd_terminal_resize', { id, cols, rows });
export const terminalClose = (id: string) => invoke<void>('cmd_terminal_close', { id });
export const modelsList = () => invoke<ModelInfo[]>('cmd_models_list');
export const authLogin = () => invoke<UserProfile>('cmd_auth_login');
export const authLogout = () => invoke<void>('cmd_auth_logout');
export const authGetUser = () => invoke<UserProfile | null>('cmd_auth_get_user');
export const authCompleteOnboarding = () => invoke<void>('cmd_auth_complete_onboarding');
export const quotaGet = () => invoke<unknown>('cmd_quota_get');
export const appVersion = () => invoke<string>('cmd_app_version');
export const settingsOpen = () => invoke<void>('cmd_settings_open');
export const countTokens = (text: string, modelId: string) => invoke<number>('cmd_count_tokens', { text, modelId });
export const pickFolder = () => invoke<string | null>('cmd_pick_folder');
export type UpdateInfo = { available: boolean; version?: string; body?: string; platform: string };
export const updaterCheck = () => invoke<UpdateInfo>('cmd_updater_check');
export const updaterInstall = () => invoke<void>('cmd_updater_install');
export const appRestart = () => invoke<void>('cmd_app_restart');
// ═══════════════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════════════
export const onAppState = (cb: (s: AppSnapshot) => void) => listen<AppSnapshot>('app:state', e => cb(e.payload));
export const onAuthChanged = (cb: (u: UserProfile | null) => void) => listen<UserProfile | null>('auth://changed', e => cb(e.payload));
export const onTerminalData = (id: string, cb: (d: string) => void) => listen<string>(`terminal:data:${id}`, e => cb(e.payload));
