import * as React from 'react';
import { cn } from '@/lib/utils';
const variants = { default: 'bg-primary/20 text-primary', secondary: 'bg-muted text-muted-foreground', outline: 'border border-border text-foreground', destructive: 'bg-destructive/20 text-destructive' };
export function Badge({ className, variant = 'default', ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: keyof typeof variants }) {
  return <span className={cn('inline-flex items-center rounded-sm px-1.5 py-0.5 text-micro font-medium', variants[variant], className)} {...props} />;
}
