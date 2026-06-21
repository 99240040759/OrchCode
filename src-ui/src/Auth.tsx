import { createSignal, onMount } from 'solid-js';
import lottie from 'lottie-web';
import { authLogin } from './api';
import { setUser } from './store';

export default function Auth() {
  let lottieRef!: HTMLDivElement;
  const [loading, setLoading] = createSignal(false);
  const [err, setErr] = createSignal('');

  onMount(() => {
    import('../assets/onboarding-entry.json').then(data => {
      lottie.loadAnimation({
        container: lottieRef, renderer: 'svg', loop: true, autoplay: true,
        animationData: data.default,
      });
    });
  });

  async function login() {
    setLoading(true); setErr('');
    try {
      const u = await authLogin();
      setUser(u);
    } catch(e) { setErr(String(e)); }
    setLoading(false);
  }

  return (
    <div class="full-page">
      <div class="lottie-wrap" ref={lottieRef}/>
      <div>
        <h1 class="page-title">Orch Code</h1>
        <p class="page-sub">Your AI coding assistant. Sign in to get started.</p>
      </div>
      <button class="btn-primary" onClick={login} disabled={loading()}>
        {loading() ? <span class="spinner"/> : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        )}
        {loading() ? 'Signing in…' : 'Sign in with Google'}
      </button>
      {err() && <p style="color:var(--status-red);font-size:12px">{err()}</p>}
    </div>
  );
}
