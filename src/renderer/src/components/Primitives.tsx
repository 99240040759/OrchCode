import React from 'react'

export const Panel: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`panel-root ${className}`} {...props}>
    {children}
  </div>
)

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: string | React.ReactNode
  title: string
  description?: string
}

// M-8 FIX: Removed redundant `typeof icon === 'string' ? icon : icon` ternary.
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  className = '',
  ...props
}) => (
  <div className={`empty-state-root ${className}`} {...props}>
    {icon && <div className="empty-state-icon">{icon}</div>}
    <h3 className="empty-state-title">{title}</h3>
    {description && <p className="empty-state-desc-prim">{description}</p>}
  </div>
)
