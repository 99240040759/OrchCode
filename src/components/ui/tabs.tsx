import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Tabs({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root data-slot="tabs" data-orientation={orientation} orientation={orientation}
      className={cn("group/tabs flex gap-0 data-[orientation=horizontal]:flex-col", className)} {...props} />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex items-center justify-start gap-0.5 text-foreground/40 group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  { variants: { variant: { default: "bg-transparent", line: "bg-transparent gap-0.5" } }, defaultVariants: { variant: "default" } }
)

function TabsList({ className, variant = "default", ...props }: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  return <TabsPrimitive.List data-slot="tabs-list" data-variant={variant} className={cn(tabsListVariants({ variant }), className)} {...props} />
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-6 flex-none items-center justify-center gap-1 rounded px-2 text-xs font-medium whitespace-nowrap",
        "text-foreground/40 transition-colors duration-100 interactive",
        "hover:text-foreground/70 hover:bg-white/4",
        "data-[state=active]:bg-white/6 data-[state=active]:text-foreground/80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "disabled:pointer-events-none disabled:opacity-30",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props} />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
