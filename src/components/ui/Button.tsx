import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'text'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  /** Shows a pending state, disables interaction, and sets aria-busy. */
  loading?: boolean
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: styles.primary,
  secondary: styles.secondary,
  text: styles.text,
}

export function Button({
  variant = 'primary',
  loading = false,
  disabled = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[styles.button, VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  )
}
