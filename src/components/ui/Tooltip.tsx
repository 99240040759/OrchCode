import React, { useState, useEffect } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/utils";
import { useOverlayStore } from "./DropdownMenu";

export const TooltipProvider = TooltipPrimitive.Provider;

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn("TooltipContent", className)}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  delayDuration?: number;
  className?: string;
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  sideOffset = 6,
  delayDuration = 350,
  className,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const overlayOpen = useOverlayStore((s) => s.count > 0);

  useEffect(() => {
    if (overlayOpen || disabled || !content) {
      setOpen(false);
    }
  }, [overlayOpen, disabled, content]);

  if (disabled || !content) return children;

  return (
    <TooltipPrimitive.Root
      open={open && !overlayOpen}
      onOpenChange={setOpen}
      delayDuration={delayDuration}
      disableHoverableContent
    >
      <TooltipPrimitive.Trigger
        asChild
        onFocus={(e) => {
          e.preventDefault();
        }}
      >
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={className}
      >
        {content}
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}
