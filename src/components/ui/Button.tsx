import { Button as VendorButton } from '@openai/apps-sdk-ui/components/Button'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'destructive'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color' | 'children'> {
  variant?: ButtonVariant
  /** Shows a pending state, disables interaction, and sets aria-busy. */
  loading?: boolean
  /** Stretch to the container width. */
  block?: boolean
  children: ReactNode
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = 'primary',
  loading = false,
  block = false,
  disabled = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    variant === 'secondary' ? styles.secondary : variant === 'destructive' ? styles.destructive : styles.primary,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <VendorButton
      {...rest}
      type={type}
      color={variant === 'secondary' ? 'secondary' : 'primary'}
      variant={variant === 'secondary' ? 'outline' : 'solid'}
      pill={false}
      size="3xl"
      block={block}
      loading={loading}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
    >
      {children}
    </VendorButton>
  )
}
