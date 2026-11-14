import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { useOverlayStore } from "./overlay";

export const TooltipProvider = TooltipPrimitive.Provider;

export type TooltipSide = "top" | "right" | "bottom" | "left";

interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: TooltipSide;
  align?: "start" | "center" | "end";
}

export function Tooltip({ content, children, side = "top", align = "center" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const overlayOpen = useOverlayStore((s) => s.count > 0);

  useEffect(() => {
    if (overlayOpen || !content) setOpen(false);
  }, [overlayOpen, content]);

  if (!content) return children;

  return (
    <TooltipPrimitive.Root open={open && !overlayOpen} onOpenChange={setOpen}>
      <TooltipPrimitive.Trigger asChild onFocus={(e) => e.preventDefault()}>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="tooltip" side={side} align={align} sideOffset={6} collisionPadding={8}>
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
