import React from 'react'
import { cn } from '../lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip'
import { Slot } from 'radix-ui'
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'active' | 'bright' | 'outline' | 'destructive' | 'tab-active' | 'tab-inactive'
  size?: 'xs' | 'sm' | 'md'
  tooltip?: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  asChild?: boolean
}
export function Button({ className, variant = 'default', size = 'md', tooltip, tooltipSide, asChild = false, onClick, ...props }: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot.Root : 'button'
  const isTab = variant.startsWith('tab')
  const btn = (
    <Comp onClick={onClick} className={cn(
      isTab ? 'group flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all outline-none flex-shrink-0 cursor-pointer border text-sm font-medium'
            : 'inline-flex items-center justify-center transition-colors cursor-pointer border-none outline-none font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      {
        'bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent': variant === 'default',
        'text-muted-foreground hover:text-foreground hover:bg-accent': variant === 'ghost',
        'bg-secondary text-secondary-foreground': variant === 'active',
        'bg-primary text-primary-foreground hover:opacity-90 focus:opacity-90': variant === 'bright',
        'border border-border bg-transparent hover:bg-accent text-muted-foreground hover:text-foreground': variant === 'outline',
        'bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md': variant === 'destructive',
        'bg-card text-foreground shadow-sm border-border': variant === 'tab-active',
        'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground border-transparent': variant === 'tab-inactive'
      },
      !isTab && {
        'px-2 py-1 text-xs rounded-md': size === 'xs',
        'px-2.5 py-1 text-sm rounded-md': size === 'sm',
        'px-3 py-1.5 text-sm rounded-md': size === 'md'
      },
      className
    )} {...props} />
  )
  return tooltip ? <Tooltip><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent side={tooltipSide}>{tooltip}</TooltipContent></Tooltip> : btn
}
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md'; tooltip?: string; tooltipSide?: 'top' | 'right' | 'bottom' | 'left'; asChild?: boolean
}
export function IconButton({ className, size = 'md', tooltip, tooltipSide, asChild = false, onClick, ...props }: IconButtonProps): React.ReactElement {
  const Comp = asChild ? Slot.Root : 'button'
  const btn = (
    <Comp onClick={onClick} className={cn(
      'flex items-center justify-center rounded transition-colors cursor-pointer border-none outline-none flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      size === 'sm' ? 'w-6 h-6' : 'w-7 h-7 rounded-md text-muted-foreground hover:text-foreground',
      className
    )} {...props} />
  )
  return tooltip ? <Tooltip><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent side={tooltipSide}>{tooltip}</TooltipContent></Tooltip> : btn
}
export interface TabButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { active?: boolean; asChild?: boolean }
export function TabButton({ active, ...props }: TabButtonProps): React.ReactElement {
  return <Button variant={active ? 'tab-active' : 'tab-inactive'} {...props} />
}
