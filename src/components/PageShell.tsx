import type { ReactNode } from 'react'
import styles from './screens.module.css'

interface PageShellProps {
  title?: string
  description?: string
  /** Scenario title stays a compact label so the screen can supply the only h1. */
  compactTitle?: boolean
  children: ReactNode
}

/** Quiet label and scenario title above the current screen. */
export function PageShell({ title, description, compactTitle = false, children }: PageShellProps) {
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <header className={styles.header}>
          {title && !compactTitle ? (
            <>
              <p className={styles.eyebrow}>Doorstep practice</p>
              <h1 className={styles.title}>{title}</h1>
              {description ? <p className={styles.intro}>{description}</p> : null}
            </>
          ) : title ? (
            <>
              <p className={styles.eyebrow}>Doorstep practice</p>
              <p className={styles.contextTitle}>{title}</p>
            </>
          ) : (
            <h1 className={styles.eyebrow}>Doorstep practice</h1>
          )}
        </header>
        {children}
      </div>
    </main>
  )
}
