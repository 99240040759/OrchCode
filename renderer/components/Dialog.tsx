import React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
interface DialogProps { isOpen: boolean; onClose: () => void; title?: string; children: React.ReactNode; className?: string }
export const Dialog: React.FC<DialogProps> = ({ isOpen, onClose, title, children, className = '' }) => {
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={val => !val && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="app-dialog-overlay" />
        <DialogPrimitive.Content className={`app-dialog ${className}`}>
          <div className="app-dialog-content">
            {title && <div className="app-dialog-header"><DialogPrimitive.Title className="app-dialog-title">{title}</DialogPrimitive.Title></div>}
            <div className="app-dialog-body">{children}</div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
export default Dialog
