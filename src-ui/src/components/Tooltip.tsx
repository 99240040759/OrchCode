import type { JSX } from 'solid-js';
import { Tooltip } from '@kobalte/core/tooltip';

interface Props { content: JSX.Element; children: JSX.Element; placement?: 'top'|'bottom'|'left'|'right'; delay?: number }
export default function KTooltip(props: Props) {
  return (
    <Tooltip openDelay={props.delay ?? 400} placement={props.placement ?? 'top'}>
      <Tooltip.Trigger as="span">{props.children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="ktooltip">
          <Tooltip.Arrow class="ktooltip-arrow"/>
          {props.content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip>
  );
}
