import { forwardRef } from "react";
import { cn } from "../../lib/utils";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn("Button", className)} {...props} />
));

Button.displayName = "Button";
