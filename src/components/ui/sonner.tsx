import * as React from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { 
  IoCheckmarkCircle, 
  IoInformationCircle, 
  IoWarning, 
  IoCloseCircle 
} from "react-icons/io5"
import { CgSpinner } from "react-icons/cg"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = (() => {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  })();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <IoCheckmarkCircle className="size-4 text-green-500" />,
        info: <IoInformationCircle className="size-4 text-blue-500" />,
        warning: <IoWarning className="size-4 text-yellow-500" />,
        error: <IoCloseCircle className="size-4 text-red-500" />,
        loading: <CgSpinner className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
