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

export function Button({
  className,
  variant = 'default',
  size = 'md',
  tooltip,
  tooltipSide,
  asChild = false,
  onClick,
  ...props
}: ButtonProps): React.ReactElement {
  const Comp = asChild ? Slot.Root : 'button'
  const isTab = variant.startsWith('tab')
  const btn = (
    <Comp
      onClick={onClick}
      className={cn(
        isTab 
          ? 'group flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all outline-none flex-shrink-0 cursor-pointer border text-sm font-medium'
          : 'inline-flex items-center justify-center transition-colors cursor-pointer border-none outline-none font-medium focus-visible:ring-2 focus-visible:ring-tx-sub focus-visible:ring-offset-2 focus-visible:ring-offset-oc-surface',
        {
          'bg-transparent text-tx-sub hover:text-tx-main hover:bg-oc-hover': variant === 'default',
          'text-tx-dim hover:text-tx-sub hover:bg-oc-hover': variant === 'ghost',
          'bg-oc-active text-tx-bright': variant === 'active',
          'bg-tx-bright text-oc-base hover:opacity-90 focus:opacity-90': variant === 'bright',
          'border border-oc-border bg-transparent hover:bg-oc-hover text-tx-sub hover:text-tx-main': variant === 'outline',
          'bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/60 rounded-md': variant === 'destructive',
          'bg-oc-surface text-tx-bright shadow-sm border-oc-border': variant === 'tab-active',
          'bg-transparent text-tx-dim hover:bg-oc-raised hover:text-tx-main border-transparent': variant === 'tab-inactive'
        },
        !isTab && {
          'px-2 py-1 text-xs rounded-md': size === 'xs',
          'px-2.5 py-1 text-sm rounded-md': size === 'sm',
          'px-3 py-1.5 text-sm rounded-md': size === 'md'
        },
        className
      )}
      {...props}
    />
  )
  return tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    btn
  )
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md'
  tooltip?: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  asChild?: boolean
}

export function IconButton({
  className,
  size = 'md',
  tooltip,
  tooltipSide,
  asChild = false,
  onClick,
  ...props
}: IconButtonProps): React.ReactElement {
  const Comp = asChild ? Slot.Root : 'button'
  const btn = (
    <Comp
      onClick={onClick}
      className={cn(
        'flex items-center justify-center rounded transition-colors cursor-pointer border-none outline-none flex-shrink-0 text-tx-dim hover:text-tx-sub hover:bg-oc-hover focus-visible:ring-2 focus-visible:ring-tx-sub focus-visible:ring-offset-2 focus-visible:ring-offset-oc-surface',
        size === 'sm' ? 'w-6 h-6' : 'w-7 h-7 rounded-md text-tx-sub hover:text-tx-main',
        className
      )}
      {...props}
    />
  )
  return tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    btn
  )
}

export interface TabButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  asChild?: boolean
}

export function TabButton({
  active,
  ...props
}: TabButtonProps): React.ReactElement {
  return (
    <Button
      variant={active ? 'tab-active' : 'tab-inactive'}
      {...props}
    />
  )
}
