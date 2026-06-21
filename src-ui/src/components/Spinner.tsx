import type { JSX } from 'solid-js';
import { mergeProps } from 'solid-js';
interface Props { size?: number; color?: string; class?: string }
export default function Spinner(props: Props) {
  const p = mergeProps({ size: 14 }, props);
  return (
    <svg class={`spin-icon${p.class ? ' '+p.class : ''}`} width={p.size} height={p.size}
      viewBox="0 0 24 24" fill="none" stroke={p.color ?? 'currentColor'}
      stroke-width="2.5" stroke-linecap="round">
      <path d="M12 2a10 10 0 1 0 10 10"/>
    </svg>
  );
}
