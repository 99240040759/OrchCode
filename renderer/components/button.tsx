import React from 'react'
import { cn } from '../lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'ghost' | 'active' | 'bright'
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
  const btn = (
    <Comp
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center transition-colors cursor-pointer border-none outline-none font-medium focus-visible:ring-2 focus-visible:ring-tx-sub focus-visible:ring-offset-2 focus-visible:ring-offset-oc-surface',
        {
          'bg-transparent text-tx-sub hover:text-tx-main hover:bg-oc-hover': variant === 'default',
          'text-tx-dim hover:text-tx-sub hover:bg-oc-hover': variant === 'ghost',
          'bg-oc-active text-tx-bright': variant === 'active',
          'bg-tx-bright text-oc-base hover:opacity-90 focus:opacity-90': variant === 'bright'
        },
        {
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

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none cursor-pointer disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
)

export function UiButton({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export interface TabButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  asChild?: boolean
}

export function TabButton({
  className,
  active,
  asChild = false,
  onClick,
  ...props
}: TabButtonProps): React.ReactElement {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all outline-none focus-visible:ring-2 focus-visible:ring-tx-sub focus-visible:ring-offset-2 focus-visible:ring-offset-oc-surface flex-shrink-0 cursor-pointer border text-sm font-medium',
        active
          ? 'bg-oc-surface text-tx-bright shadow-sm border-oc-border'
          : 'bg-transparent text-tx-dim hover:bg-oc-raised hover:text-tx-main border-transparent',
        className
      )}
      {...props}
    />
  )
}
