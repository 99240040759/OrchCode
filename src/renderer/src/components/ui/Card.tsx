import React from 'react'
import * as styles from './Primitives.css'

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  noPadding?: boolean
}

export const Card: React.FC<CardProps> = ({ children, noPadding = false, className, ...props }) => {
  const baseClass = styles.card
  const paddingClass = noPadding ? styles.cardNoPadding : ''
  const combinedClassName = [baseClass, paddingClass, className].filter(Boolean).join(' ')

  return (
    <div className={combinedClassName} {...props}>
      {children}
    </div>
  )
}
