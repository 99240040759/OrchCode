import React from 'react'
import * as styles from './Primitives.css'

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  variant?: 'ghost' | 'solid'
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  size = 'md',
  variant = 'ghost',
  className,
  ...props
}) => {
  const baseClass = styles.iconBtn
  const sizeClass = size === 'sm' ? styles.iconBtnSm : size === 'lg' ? styles.iconBtnLg : styles.iconBtnMd
  const variantClass = variant === 'solid' ? styles.iconBtnSolid : styles.iconBtnGhost
  
  const combinedClassName = [baseClass, sizeClass, variantClass, className].filter(Boolean).join(' ')

  return (
    <button className={combinedClassName} {...props}>
      {icon}
    </button>
  )
}
