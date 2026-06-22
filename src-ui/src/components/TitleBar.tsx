import { createSignal, Show, onMount, For } from 'solid-js';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import {
  authLogout, quotaGet, pickFolder,
  stateOpenWorkspace, stateActivateWorkspace, stateCloseWorkspace,
  updaterCheck, updaterInstall, appRestart, type UpdateInfo,
} from '../api';
import {
  user, setUser, isDark, setIsDark, activeThread,
  workspaces, workspacePath, isStreaming, setAppState,
} from '../store';
import Dropdown from './Dropdown';
import Dialog from './Dialog';
import { VsFolder, VsChromeMinimize, VsChromeMaximize, VsChromeClose } from 'solid-icons/vs';
import { BiRegularTrash, BiRegularMoon, BiRegularSun, BiRegularLogOut } from 'solid-icons/bi';
import { getCurrentWindow } from '@tauri-apps/api/window';
const win = getCurrentWindow();
const isMac = navigator.userAgent.includes('Mac OS X');
export default function TitleBar() {
  const [quota, setQuota] = createSignal<Record<string, any> | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<{ path: string; name: string } | null>(null);
  const [updateReady, setUpdateReady] = createSignal(false);
  const [updateInfo, setUpdateInfo] = createSignal<UpdateInfo | null>(null);
  const [updating, setUpdating] = createSignal(false);
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const quotaUsed = () => quota()?.cost_usd as number ?? 0;
  const quotaLimit = () => quota()?.limit_usd as number ?? 0;
  onMount(async () => {
    try { setQuota(await quotaGet() as Record<string, any>); } catch {}
    try {
      if (!import.meta.env.PROD) return;
      const info = await updaterCheck();
      if (info.available) {
        setUpdateInfo(info);
        if (info.platform === 'windows') {
          setUpdating(true); await updaterInstall(); setUpdating(false); setUpdateReady(true);
        }
      }
    } catch {}
    win.isFullscreen().then(setIsFullscreen).catch(() => {});
    win.onResized(() => { win.isFullscreen().then(setIsFullscreen).catch(() => {}); }).catch(() => {});
  });
  // ONE CALL — backend does everything atomically
  async function openWorkspace() {
    const path = await pickFolder();
    if (!path) return;
    const snap = await stateOpenWorkspace(path);
    setAppState(snap);
  }
  // ONE CALL — backend cancels agents, stops watcher, loads threads, starts watcher
  async function activateWorkspace(path: string) {
    const snap = await stateActivateWorkspace(path);
    setAppState(snap);
  }
  // ONE CALL — backend cancels agents, deletes data, switches to next workspace
  async function confirmDelete() {
    const t = deleteTarget();
    if (!t) return;
    const snap = await stateCloseWorkspace(t.path);
    setAppState(snap);
    setDeleteTarget(null);
  }
  async function handleLogout() { await authLogout(); setUser(null); }
  const avatarSrc = () => user()?.avatar_url ?? null;
  return (
    <>
    <div class={`titlebar${isMac ? ' mac' : ''}${isFullscreen() ? ' fullscreen' : ''}`} data-tauri-drag-region>
      <div class="titlebar-left">
        <button class="tb-workspace-btn" onClick={openWorkspace}>
          <VsFolder size={13}/><span class="tb-label">Open Workspace</span>
        </button>
        <div class="tb-divider"/>
        <div class="tb-workspace-tabs">
          <For each={workspaces()}>{ws => (
            <div class={`tb-ws-tab${workspacePath() === ws.path ? ' active' : ''}`} onClick={() => activateWorkspace(ws.path)}>
              <span class="tb-ws-name">{ws.name}</span>
              <Dropdown
                trigger={<button class="icon-btn tb-ws-menu" onClick={e => e.stopPropagation()}><BiRegularTrash size={11}/></button>}
                items={[{ label: 'Delete workspace', danger: true, onSelect: () => setDeleteTarget({ path: ws.path, name: ws.name }) }]}
                placement="bottom-start"
              />
            </div>
          )}</For>
        </div>
      </div>
      <div class="titlebar-center">{activeThread()?.title ?? 'Orch Code'}</div>
      <div class="titlebar-right">
        <Show when={updateReady()}>
          <button class="tb-update-btn restart" onClick={() => appRestart()} title="Update downloaded — click to restart">↻ Restart to Update</button>
        </Show>
        <Show when={updateInfo() && !updateReady() && !updating() && updateInfo()!.platform !== 'windows'}>
          <button class="tb-update-btn" onClick={() => openExternal('https://github.com/sameer786ss/OrchCode/releases/latest')} title={`v${updateInfo()!.version} available`}>↑ Update Available</button>
        </Show>
        <button class="icon-btn" title="Toggle theme" onClick={() => setIsDark(d => !d)}>
          <Show when={isDark()} fallback={<BiRegularSun size={14}/>}><BiRegularMoon size={14}/></Show>
        </button>
        <DropdownMenu placement="bottom-end">
          <DropdownMenu.Trigger class="profile-trigger" aria-label="Profile">
            <Show when={avatarSrc()} fallback={<div class="avatar-initials" style="width:22px;height:22px;font-size:11px">{(user()?.name || user()?.email || '?')[0].toUpperCase()}</div>}>
              <img class="avatar-img" src={avatarSrc()!} width={22} height={22} alt="avatar"/>
            </Show>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="kdropdown profile-dropdown">
              <div class="profile-header">
                <Show when={avatarSrc()} fallback={<div class="avatar-initials" style="width:32px;height:32px;font-size:13px">{(user()?.name || user()?.email || '?')[0].toUpperCase()}</div>}>
                  <img class="avatar-img" src={avatarSrc()!} width={32} height={32} alt="avatar"/>
                </Show>
                <div class="profile-info">
                  <div class="profile-name">{user()?.name || user()?.email?.split('@')[0]}</div>
                  <div class="profile-email">{user()?.email}</div>
                </div>
              </div>
              <Show when={quota()}>
                <div class="profile-usage">
                  <div class="profile-usage-row">
                    <span class="profile-usage-label">Budget</span>
                    <span class={`profile-usage-val${quota()?.allowed === false ? ' danger-text' : ''}`}>${quotaUsed().toFixed(4)} / ${quotaLimit().toFixed(2)}</span>
                  </div>
                  <div class="profile-quota-bar">
                    <div class="profile-quota-fill" style={`width:${Math.min(quotaUsed() / Math.max(quotaLimit(), 0.0001) * 100, 100)}%;background:${quota()?.allowed === false ? 'var(--status-red)' : 'var(--accent)'}`}/>
                  </div>
                  <div class="profile-usage-row" style="margin-top:3px">
                    <span class="profile-usage-label" style="font-size:10px;opacity:0.6">{quota()?.allowed === false ? '⚠ Budget exceeded' : `$${(quota()?.remaining as number ?? 0).toFixed(4)} remaining`}</span>
                    <span class="profile-usage-label" style="font-size:10px;opacity:0.6">resets {quota()?.period ?? '—'}-01</span>
                  </div>
                </div>
              </Show>
              <div class="kdropdown-sep"/>
              <DropdownMenu.Item class="kdropdown-item danger" onSelect={handleLogout}>
                <BiRegularLogOut size={13}/><span class="kdropdown-label">Sign out</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
        <Show when={!isMac}>
          <button class="win-btn" onClick={() => win.minimize()}><VsChromeMinimize size={14}/></button>
          <button class="win-btn" onClick={() => win.toggleMaximize()}><VsChromeMaximize size={14}/></button>
          <button class="win-btn close" onClick={() => win.close()}><VsChromeClose size={14}/></button>
        </Show>
      </div>
    </div>
    <Show when={deleteTarget()}>
      <Dialog open={true} onClose={() => setDeleteTarget(null)} title="Delete workspace?" description={`"${deleteTarget()!.name}" — all chats, artifacts, and RAG index will be permanently removed.`}>
        <div class="dialog-actions">
          <button class="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
          <button class="btn-danger" onClick={confirmDelete}>Delete</button>
        </div>
      </Dialog>
    </Show>
    </>
  );
}
