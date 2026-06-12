import React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
interface TooltipProps { content: React.ReactNode; children: React.ReactElement; side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end'; sideOffset?: number; [key: string]: any }
export const Tooltip: React.FC<TooltipProps> = ({ content, children, side = 'top', align = 'center', sideOffset = 4, ...props }) => {
  if (!content) return React.cloneElement(children, props)
  return (
    <TooltipPrimitive.Provider delayDuration={400}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild {...props}>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side={side} align={align} sideOffset={sideOffset} className="app-tooltip-content">
            {content}
            <TooltipPrimitive.Arrow className="app-tooltip-arrow" width={8} height={4} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
export default Tooltip
