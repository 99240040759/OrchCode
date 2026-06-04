import React from 'react'
import * as styles from './ui/Primitives.css'

export const Panel: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`${styles.panelRoot} ${className}`} {...props}>
    {children}
  </div>
)

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: string | React.ReactNode
  title: string
  description?: string
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  className = '',
  ...props
}) => (
  <div className={`${styles.emptyStateRoot} ${className}`} {...props}>
    {icon && <div className={styles.emptyStateIcon}>{typeof icon === 'string' ? icon : icon}</div>}
    <h3 className={styles.emptyStateTitle}>{title}</h3>
    {description && <p className={styles.emptyStateDesc}>{description}</p>}
  </div>
)
