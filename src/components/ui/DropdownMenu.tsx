import React, { forwardRef, useEffect } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { create } from "zustand";
import { cn } from "../../lib/api";

export const useOverlayStore = create<{ count: number; change: (delta: number) => void }>((set) => ({
  count: 0,
  change: (delta) => set((s) => ({ count: Math.max(0, s.count + delta) })),
}));

function OverlayPresence() {
  const change = useOverlayStore((s) => s.change);
  useEffect(() => {
    change(1);
    return () => change(-1);
  }, [change]);
  return null;
}

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, children, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn("DropdownMenuContent", className)}
      {...props}
    >
      <OverlayPresence />
      {children}
    </DropdownMenuPrimitive.Content>
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item ref={ref} className={cn("DropdownMenuItem", className)} {...props} />
));
DropdownMenuItem.displayName = "DropdownMenuItem";
