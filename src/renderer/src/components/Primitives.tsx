import React from 'react'
import * as styles from './ui/Primitives.css'

export const Panel: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className = '', ...props }) => (
  <div className={`${styles.panelRoot} ${className}`} {...props}>
    {children}
  </div>
)

export const Toolbar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className = '', ...props }) => (
  <div className={`${styles.toolbarRoot} ${className}`} {...props}>
    {children}
  </div>
)

interface SpacerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  horizontal?: boolean
}

export const Spacer: React.FC<SpacerProps> = ({ size = 'md', horizontal = false, className = '', ...props }) => {
  let spacerClass = ''
  if (horizontal) {
    if (size === 'xs') spacerClass = styles.spacerHXs
    else if (size === 'sm') spacerClass = styles.spacerHSm
    else if (size === 'md') spacerClass = styles.spacerHMd
    else if (size === 'lg') spacerClass = styles.spacerHLg
    else if (size === 'xl') spacerClass = styles.spacerHXl
  } else {
    if (size === 'xs') spacerClass = styles.spacerVXs
    else if (size === 'sm') spacerClass = styles.spacerVSm
    else if (size === 'md') spacerClass = styles.spacerVMd
    else if (size === 'lg') spacerClass = styles.spacerVLg
    else if (size === 'xl') spacerClass = styles.spacerVXl
  }
  return <div className={`${spacerClass} ${className}`} {...props} />
}

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: string | React.ReactNode
  title: string
  description?: string
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description, className = '', ...props }) => (
  <div className={`${styles.emptyStateRoot} ${className}`} {...props}>
    {icon && (
      <div className={styles.emptyStateIcon}>
        {typeof icon === 'string' ? icon : icon}
      </div>
    )}
    <h3 className={styles.emptyStateTitle}>{title}</h3>
    {description && <p className={styles.emptyStateDesc}>{description}</p>}
  </div>
)
