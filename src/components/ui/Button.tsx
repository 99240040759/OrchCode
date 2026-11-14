import type { ComponentProps, ReactNode } from "react";
import { Tooltip, type TooltipSide } from "./Tooltip";

type Variant = "ghost" | "subtle" | "primary" | "danger";
type Size = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
  icon?: boolean;
  block?: boolean;
  active?: boolean;
}

export function Button({ variant, size, icon, block, active, className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={className ? `btn ${className}` : "btn"}
      data-variant={variant}
      data-size={size}
      data-icon={icon || undefined}
      data-block={block || undefined}
      data-active={active || undefined}
      {...props}
    />
  );
}

interface IconButtonProps extends Omit<ButtonProps, "icon"> {
  label: string;
  tip?: ReactNode;
  side?: TooltipSide;
}

export function IconButton({ label, tip, side = "bottom", ...props }: IconButtonProps) {
  return (
    <Tooltip content={tip ?? label} side={side}>
      <Button icon aria-label={label} {...props} />
    </Tooltip>
  );
}
