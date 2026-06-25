import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-1.5 py-0 text-[11px] font-medium whitespace-nowrap transition-colors duration-100 [&>svg]:pointer-events-none [&>svg]:size-2.5",
  {
    variants: {
      variant: {
        default:     "bg-primary text-primary-foreground",
        secondary:   "bg-white/8 text-foreground/70",
        destructive: "bg-destructive text-white",
        outline:     "border-border/60 text-foreground/60",
        ghost:       "text-foreground/50",
        link:        "text-primary underline-offset-4",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({ className, variant = "default", asChild = false, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
