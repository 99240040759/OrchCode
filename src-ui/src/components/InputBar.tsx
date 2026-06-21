import { createSignal, onCleanup } from 'solid-js';
import Dropdown from './Dropdown';
import type { ModelInfo } from '../api';
import { countTokens } from '../api';
interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: () => boolean;
  models: () => ModelInfo[];
  selectedModel: () => string;
  setSelectedModel: (id: string) => void;
  streamTokens: () => { input: number; output: number };
}
const R = 7, C = 2 * Math.PI * R;
const fmt = (n: number) => n > 999 ? `${(n/1000).toFixed(1)}k` : String(n);
export default function InputBar(props: Props) {
  let textareaEl!: HTMLTextAreaElement;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const [input, setInput] = createSignal('');
  const [inputTokens, setInputTokens] = createSignal(0);
  onCleanup(() => { if (debounce) clearTimeout(debounce); });
  function scheduleCount(text: string) {
    if (debounce) clearTimeout(debounce);
    if (!text) { setInputTokens(0); return; }
    debounce = setTimeout(async () => {
      const n = await countTokens(text, props.selectedModel()).catch(() => 0);
      setInputTokens(n as number);
    }, 120);
  }
  const totalTokens = () => {
    if (props.isStreaming()) { const st = props.streamTokens(); return st.input + st.output; }
    return inputTokens();
  };
  const tokenRatio = () => {
    const model = props.models().find(m => m.id === props.selectedModel());
    const max = model?.contextWindow ?? 200_000;
    return Math.min(totalTokens() / max, 1);
  };
  const ringColor = () => {
    const r = tokenRatio();
    if (r > 0.85) return 'var(--status-red)';
    if (r > 0.6) return 'var(--status-amber)';
    return 'var(--accent)';
  };
  function autoResize() { textareaEl.style.height = 'auto'; textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + 'px'; }
  function onKey(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }
  function submit() {
    const text = input().trim();
    if (!text || props.isStreaming()) return;
    props.onSend(text); setInput(''); setInputTokens(0);
    if (textareaEl) textareaEl.style.height = 'auto';
  }
  return (
    <div class="input-bar">
      <div class="input-bar-top">
        <textarea ref={textareaEl} placeholder="Message Orch Code…" rows={1} value={input()}
          onInput={e => { const v = e.currentTarget.value; setInput(v); autoResize(); scheduleCount(v); }}
          onKeyDown={onKey} disabled={props.isStreaming()}/>
      </div>
      <div class="input-bar-bottom">
        <div class="input-bar-actions">
          <Dropdown
            trigger={<button class="select-trigger"><span class="select-value">{props.models().find(m => m.id === props.selectedModel())?.name ?? 'Model'}</span>
              <span class="select-icon"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg></span></button>}
            items={props.models().map(m => ({ label: m.name + (m.badge ? ` · ${m.badge}` : ''), onSelect: () => props.setSelectedModel(m.id) }))}
            placement="top-start"/>
        </div>
        <div class="input-bar-right">
          <div class="token-ring-wrap" title={props.isStreaming() ? `in: ${fmt(props.streamTokens().input)} · out: ${fmt(props.streamTokens().output)}` : `${inputTokens()} tokens`}>
            <svg class="token-ring" width="20" height="20" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r={R} fill="none" stroke="var(--border)" stroke-width="1.8"/>
              <circle cx="10" cy="10" r={R} fill="none" stroke={ringColor()} stroke-width="1.8" stroke-linecap="round"
                stroke-dasharray={String(C)} stroke-dashoffset={String(C * (1 - tokenRatio()))} transform="rotate(-90 10 10)"
                style="transition:stroke-dashoffset 0.3s ease,stroke 0.3s ease"/>
            </svg>
          </div>
          {props.isStreaming() ? (
            <button class="stop-btn" onClick={props.onStop}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
              <span>Stop</span>
            </button>
          ) : (
            <button class="send-btn" onClick={submit} disabled={!input().trim()}>
              <span>Send</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
