import type { ComponentProps, ReactNode } from "react";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import { LuCheck, LuChevronRight } from "react-icons/lu";
import { OverlayPresence } from "./overlay";

export const Menu = Primitive.Root;
export const MenuTrigger = Primitive.Trigger;
export const MenuSub = Primitive.Sub;

const cls = (base: string, extra?: string) => (extra ? `${base} ${extra}` : base);

export function MenuContent({
  className,
  children,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        className={cls("menu", className)}
        sideOffset={sideOffset}
        collisionPadding={8}
        onCloseAutoFocus={(e) => e.preventDefault()}
        {...props}
      >
        <OverlayPresence />
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function MenuItem({
  className,
  selected,
  children,
  ...props
}: ComponentProps<typeof Primitive.Item> & { selected?: boolean }) {
  return (
    <Primitive.Item className={cls("row", className)} data-selected={selected || undefined} {...props}>
      {children}
      {selected && <LuCheck className="row-end" aria-label="Selected" />}
    </Primitive.Item>
  );
}

export function MenuCheckboxItem({ className, children, ...props }: ComponentProps<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem className={cls("row", className)} {...props}>
      {children}
      <Primitive.ItemIndicator className="row-end">
        <LuCheck />
      </Primitive.ItemIndicator>
    </Primitive.CheckboxItem>
  );
}

export function MenuSubTrigger({
  className,
  children,
  meta,
  selected,
  ...props
}: ComponentProps<typeof Primitive.SubTrigger> & { meta?: ReactNode; selected?: boolean }) {
  return (
    <Primitive.SubTrigger className={cls("row", className)} data-selected={selected || undefined} {...props}>
      {children}
      <span className="row-end">
        {meta}
        {selected && <LuCheck aria-label="Selected" />}
        <LuChevronRight />
      </span>
    </Primitive.SubTrigger>
  );
}

export function MenuSubContent({ className, children, ...props }: ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent className={cls("menu", className)} sideOffset={6} collisionPadding={8} {...props}>
        <OverlayPresence />
        {children}
      </Primitive.SubContent>
    </Primitive.Portal>
  );
}

export function MenuSeparator() {
  return <Primitive.Separator className="menu-sep" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Primitive.Label className="menu-label">{children}</Primitive.Label>;
}
