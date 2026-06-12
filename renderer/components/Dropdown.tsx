import React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
interface DropdownProps { trigger: React.ReactElement; children: React.ReactNode; align?: 'start' | 'center' | 'end'; side?: 'top' | 'right' | 'bottom' | 'left'; sideOffset?: number; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string }
export const Dropdown: React.FC<DropdownProps> = ({ trigger, children, align = 'center', side = 'bottom', sideOffset = 6, open, onOpenChange, className = '' }) => {
  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content align={align} side={side} sideOffset={sideOffset} className={`app-dropdown-panel dropdown-menu-content ${className}`}>
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}
export const DropdownItem = DropdownMenuPrimitive.Item
export const DropdownSeparator = DropdownMenuPrimitive.Separator
export default Dropdown
