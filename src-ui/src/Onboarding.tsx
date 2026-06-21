import { createSignal, onMount, For } from 'solid-js';
import lottie from 'lottie-web';
import { authCompleteOnboarding } from './api';
import { setUser, user } from './store';

const STEPS = [
  { title: 'Welcome to Orch Code', sub: 'Your intelligent AI coding assistant that understands your entire codebase.' },
  { title: 'Chat with your code', sub: 'Ask questions, get explanations, generate code — all in natural language.' },
  { title: 'Powerful tools built-in', sub: 'Terminal, file explorer, web search and code execution at your fingertips.' },
];

export default function Onboarding() {
  let lottieRef!: HTMLDivElement;
  const [step, setStep] = createSignal(0);
  const [loading, setLoading] = createSignal(false);

  onMount(() => {
    import('../assets/onboarding-complete.json').then(data => {
      lottie.loadAnimation({
        container: lottieRef, renderer: 'svg', loop: true, autoplay: true,
        animationData: data.default,
      });
    });
  });

  async function finish() {
    setLoading(true);
    await authCompleteOnboarding().catch(() => {});
    setUser(u => u ? { ...u, onboarding_complete: true } : u);
    setLoading(false);
  }

  const cur = () => STEPS[step()];
  const isLast = () => step() === STEPS.length - 1;

  return (
    <div class="full-page">
      <div class="lottie-wrap" ref={lottieRef}/>
      <div style="text-align:center">
        <h1 class="page-title">{cur().title}</h1>
        <p class="page-sub" style="margin-top:8px">{cur().sub}</p>
      </div>
      {/* Step dots */}
      <div style="display:flex;gap:6px">
        <For each={STEPS}>{(_, i) => (
          <div style={`width:6px;height:6px;border-radius:50%;background:${i() === step() ? 'var(--accent)' : 'var(--border)'};transition:background 0.2s`}/>
        )}</For>
      </div>
      <button class="btn-primary" onClick={() => isLast() ? finish() : setStep(s => s+1)} disabled={loading()}>
        {loading() ? <span class="spinner"/> : null}
        {isLast() ? "Let's go!" : 'Next'}
      </button>
    </div>
  );
}
