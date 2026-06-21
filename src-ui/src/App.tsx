import { createEffect, onMount, Show, onCleanup } from 'solid-js';
import { authGetUser, modelsList, stateInit, onAppState, onAuthChanged, settingGet, settingSet } from './api';
import { user, setUser, setAuthLoading, isDark, setIsDark, setModels, setSelectedModel, setAppState } from './store';
import { applyTheme } from './theme';
import Chat from './Chat';
import Artifact from './Artifact';
import TitleBar from './components/TitleBar';
import Auth from './Auth';
import Onboarding from './Onboarding';
export default function App() {
  let unlistenAuth: (() => void) | null = null;
  let unlistenState: (() => void) | null = null;
  onMount(async () => {
    // Restore theme
    const savedTheme = await settingGet('theme_dark').catch(() => null);
    if (savedTheme !== null) setIsDark(savedTheme === 'true');
    else setIsDark(window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme(isDark());
    // Auth
    try { setUser(await authGetUser()); } catch {}
    setAuthLoading(false);
    // Listen for backend state changes — THE key listener
    onAppState(snap => setAppState(snap)).then(fn => { unlistenState = fn; });
    onAuthChanged(u => setUser(u)).then(fn => { unlistenAuth = fn; });
  });
  onCleanup(() => { unlistenAuth?.(); unlistenState?.(); });
  // Theme persistence
  createEffect(() => { const d = isDark(); applyTheme(d); settingSet('theme_dark', String(d)).catch(() => {}); });
  // Load models + init state on auth
  createEffect(async () => {
    if (!user()) return;
    try {
      const ms = await modelsList();
      setModels(ms);
      const savedModel = await settingGet('selected_model').catch(() => null);
      if (savedModel && ms.find(m => m.id === savedModel)) setSelectedModel(savedModel);
      else if (ms.length) setSelectedModel(ms[0].id);
    } catch (e) { console.error('[App] models:', e); }
    // Initialize backend state — ONE call, complete state
    try {
      const snap = await stateInit();
      setAppState(snap);
    } catch (e) { console.error('[App] stateInit:', e); }
  });
  return (
    <div class="app-layout">
      <Show when={user()} fallback={<Auth/>}>
        <Show when={user()?.onboarding_complete !== false} fallback={<Onboarding/>}>
          <TitleBar/>
          <div class="main-area"><Chat/><Artifact/></div>
        </Show>
      </Show>
    </div>
  );
}
