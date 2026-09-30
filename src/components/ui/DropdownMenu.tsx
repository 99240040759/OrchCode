import React, { forwardRef, useEffect, useRef } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { create } from "zustand";
import { cn } from "../../lib/api";

export const useOverlayStore = create<{ count: number; change: (delta: number) => void }>((set) => ({
  count: 0,
  change: (delta) => set((s) => ({ count: Math.max(0, s.count + delta) })),
}));

export function DropdownMenu({
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const openRef = useRef(false);
  const change = useOverlayStore((s) => s.change);

  useEffect(() => {
    return () => {
      if (openRef.current) change(-1);
    };
  }, [change]);

  return (
    <DropdownMenuPrimitive.Root
      {...props}
      onOpenChange={(open) => {
        if (open !== openRef.current) {
          openRef.current = open;
          change(open ? 1 : -1);
        }
        onOpenChange?.(open);
      }}
    />
  );
}
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn("DropdownMenuContent", className)}
      {...props}
    />
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
