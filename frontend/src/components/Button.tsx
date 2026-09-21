import type { ReactNode } from 'react'
import './Button.css'

interface ButtonProps {
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}

export default function Button({
  variant = 'primary',
  disabled = false,
  onClick,
  children,
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
