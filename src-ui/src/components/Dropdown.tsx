import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
interface MenuItem { label: string; icon?: JSX.Element; onSelect: () => void; disabled?: boolean; danger?: boolean }
interface Props { trigger: JSX.Element; items: MenuItem[]; placement?: string; menuClass?: string }
export default function KDropdown(props: Props) {
  return (
    <DropdownMenu placement={props.placement as any ?? 'bottom-start'}>
      <DropdownMenu.Trigger as="span">{props.trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class={`kdropdown${props.menuClass ? ' ' + props.menuClass : ''}`}>
          <For each={props.items}>{item => (
            <DropdownMenu.Item
              class={`kdropdown-item${item.danger ? ' danger' : ''}`}
              disabled={item.disabled}
              onSelect={item.onSelect}
            >
              <span class="kdropdown-label">{item.label}</span>
              {item.icon && <span class="kdropdown-icon">{item.icon}</span>}
            </DropdownMenu.Item>
          )}</For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
