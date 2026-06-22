import { createEffect, onMount, Show, onCleanup, Transition } from 'solid-js';
import { Store } from '@tauri-apps/plugin-store';
import { authGetUser, modelsList, stateInit, onAppState, onAuthChanged } from './api';
import { user, setUser, setAuthLoading, isDark, setIsDark, setModels, setSelectedModel, selectedModel, setAppState } from './store';
import { applyTheme } from './theme';
import Chat from './Chat';
import Artifact from './Artifact';
import TitleBar from './components/TitleBar';
import Auth from './Auth';
import Onboarding from './Onboarding';
import { getCurrentWindow } from '@tauri-apps/api/window';
const store = new Store('settings.json');
const win = getCurrentWindow();
export default function App() {
  let unlistenAuth: (() => void) | null = null;
  let unlistenState: (() => void) | null = null;
  onMount(async () => {
    const savedTheme = await store.get<string>('theme_dark').catch(() => null);
    if (savedTheme !== null) setIsDark(savedTheme === 'true');
    else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark());
    try { setUser(await authGetUser()); } catch {}
    setAuthLoading(false);
    onAppState(snap => setAppState(snap)).then(fn => { unlistenState = fn; });
    onAuthChanged(u => setUser(u)).then(fn => { unlistenAuth = fn; });
  });
  onCleanup(() => { unlistenAuth?.(); unlistenState?.(); });
  // Persist theme and sync native OS appearance
  createEffect(() => { const d = isDark(); applyTheme(d); win.setTheme(d ? 'dark' : 'light'); store.set('theme_dark', String(d)).catch(() => {}); });
  // Persist model selection
  createEffect(() => { const m = selectedModel(); if (m) store.set('selected_model', m).catch(() => {}); });
  // Load models + init state once logged in
  createEffect(async () => {
    if (!user()) return;
    try {
      const ms = await modelsList();
      setModels(ms);
      const savedModel = await store.get<string>('selected_model').catch(() => null);
      if (savedModel && ms.find(m => m.id === savedModel)) setSelectedModel(savedModel);
      else if (ms.length) setSelectedModel(ms[0].id);
    } catch (e) { console.error('[App] models:', e); }
    try {
      const snap = await stateInit();
      setAppState(snap);
    } catch (e) { console.error('[App] stateInit:', e); }
  });
  return (
    <div class="app-layout">
      <Transition name="fade" mode="out-in">
        <Show when={user()} fallback={<Auth/>}>
          <Show when={user()?.onboarding_complete !== false} fallback={<Onboarding/>}>
            <TitleBar/>
            <div class="main-area"><Chat/><Artifact/></div>
          </Show>
        </Show>
      </Transition>
    </div>
  );
}
