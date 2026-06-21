import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Dialog } from '@kobalte/core/dialog';
import { VsClose } from 'solid-icons/vs';

interface Props {
  open: boolean;
  onOpenChange?: (v: boolean) => void;
  onClose?: () => void;
  title?: string;
  description?: string;
  children: JSX.Element;
  trigger?: JSX.Element;
}
export default function KDialog(props: Props) {
  const handleChange = (v: boolean) => {
    props.onOpenChange?.(v);
    if (!v) props.onClose?.();
  };
  return (
    <Dialog open={props.open} onOpenChange={handleChange}>
      {props.trigger && <Dialog.Trigger as="span">{props.trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay class="kdialog-overlay"/>
        <Dialog.Content class="kdialog">
          <div class="kdialog-header">
            <Dialog.Title class="kdialog-title">{props.title ?? ''}</Dialog.Title>
            <Dialog.CloseButton class="kdialog-close"><VsClose size={14}/></Dialog.CloseButton>
          </div>
          <Show when={props.description}>
            <Dialog.Description class="kdialog-desc">{props.description}</Dialog.Description>
          </Show>
          <div class="kdialog-body">{props.children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
