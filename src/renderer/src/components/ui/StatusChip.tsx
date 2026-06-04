import React from 'react'
import * as styles from './Primitives.css'

export interface StatusChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: 'success' | 'warning' | 'error' | 'info' | 'default'
  children: React.ReactNode
}

export const StatusChip: React.FC<StatusChipProps> = ({ status, children, className, ...props }) => {
  const baseClass = styles.statusChip
  let statusClass = ''
  switch (status) {
    case 'success': statusClass = styles.statusChipSuccess; break;
    case 'warning': statusClass = styles.statusChipWarning; break;
    case 'error': statusClass = styles.statusChipError; break;
    case 'info': statusClass = styles.statusChipInfo; break;
    default: statusClass = styles.statusChipDefault; break;
  }
  
  const combinedClassName = [baseClass, statusClass, className].filter(Boolean).join(' ')

  return (
    <span className={combinedClassName} {...props}>
      {children}
    </span>
  )
}
