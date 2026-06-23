import * as React from "react"
import { CgSpinner } from "react-icons/cg"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<typeof CgSpinner>) {
  return (
    <CgSpinner
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
