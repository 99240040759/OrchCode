import React from 'react'
import * as styles from './Primitives.css'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: React.ReactNode
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  ...props
}) => {
  const baseClass = styles.btn
  const variantClass = variant === 'primary' ? styles.btnPrimary : variant === 'ghost' ? styles.btnGhost : ''
  const sizeClass = size === 'sm' ? styles.btnSm : size === 'lg' ? styles.btnLg : ''
  
  const combinedClassName = [baseClass, variantClass, sizeClass, className].filter(Boolean).join(' ')
  
  return (
    <button className={combinedClassName} {...props}>
      {icon && <span className="btn-icon">{icon}</span>}
      {children}
    </button>
  )
}
