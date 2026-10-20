import type { HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  element?: 'section' | 'div'
  children: ReactNode
}

/** A bordered surface. Layout inside the card belongs to feature components. */
export function Card({ element: Element = 'section', className, children, ...rest }: CardProps) {
  return (
    <Element {...rest} className={[styles.card, className].filter(Boolean).join(' ')}>
      {children}
    </Element>
  )
}
