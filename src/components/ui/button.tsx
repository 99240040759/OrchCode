import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md whitespace-nowrap font-medium interactive outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:      "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:  "bg-destructive text-white hover:bg-destructive/85",
        outline:      "border border-border bg-transparent hover:bg-white/5 hover:border-border-strong text-foreground/80 hover:text-foreground",
        secondary:    "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost:        "text-foreground/70 hover:text-foreground hover:bg-white/5",
        "ghost-muted":"text-foreground/40 hover:text-foreground/80 hover:bg-transparent",
        "sidebar-item":"justify-start font-medium text-foreground/60 hover:text-foreground hover:bg-white/5",
        "inline-code": "bg-white/6 hover:bg-white/10 text-accent-foreground font-mono",
        link:         "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:       "h-7 text-xs px-2.5 has-[>svg]:px-2",
        xs:            "h-5 text-xs gap-1 px-2 has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm:            "h-6 text-xs px-2 has-[>svg]:px-1.5",
        lg:            "h-8 text-sm px-4 has-[>svg]:px-3",
        "inline-code": "h-[18px] px-1.5 py-0 text-xs gap-1 mx-0.5 rounded-sm",
        "sidebar-item":"h-auto px-2 py-1 text-xs gap-1.5 min-w-0",
        icon:          "size-7 rounded-md",
        "icon-xs":     "size-5 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":     "size-6 rounded-md",
        "icon-lg":     "size-8 rounded-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({ className, variant = "default", size = "default", asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button"
  return <Comp data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
