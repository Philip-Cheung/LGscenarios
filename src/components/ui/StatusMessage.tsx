import type { ReactNode } from 'react'
import styles from './StatusMessage.module.css'

export interface StatusMessageProps {
  /** `error` is announced assertively; `neutral` politely. */
  tone?: 'neutral' | 'error'
  children?: ReactNode
  className?: string
  id?: string
}

/**
 * A live region for short status text. Keep it mounted and change its content
 * so assistive technology announces updates.
 */
export function StatusMessage({ tone = 'neutral', children, className, id }: StatusMessageProps) {
  return (
    <p
      id={id}
      role={tone === 'error' ? 'alert' : 'status'}
      className={[styles.status, tone === 'error' ? styles.error : null, className].filter(Boolean).join(' ')}
    >
      {children}
    </p>
  )
}
