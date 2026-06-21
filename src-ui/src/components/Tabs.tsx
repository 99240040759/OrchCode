import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { Tabs } from '@kobalte/core/tabs';
interface TabItem { value: string; label: JSX.Element }
interface Props {
  value?: string;
  onChange?: (v: string) => void;
  items: TabItem[];
  children?: JSX.Element;
  suffix?: JSX.Element;
  class?: string;
  listClass?: string;
}
export default function KTabs(props: Props) {
  return (
    <Tabs value={props.value} onChange={props.onChange} class={`ktabs${props.class ? ' '+props.class : ''}`}>
      <Tabs.List class={`ktabs-list${props.listClass ? ' '+props.listClass : ''}`}>
        <For each={props.items}>{t => (
          <Tabs.Trigger value={t.value} class="ktabs-trigger">{t.label}</Tabs.Trigger>
        )}</For>
        <Tabs.Indicator class="ktabs-indicator"/>
        {props.suffix && <div class="ktabs-suffix">{props.suffix}</div>}
      </Tabs.List>
      {props.children}
    </Tabs>
  );
}
