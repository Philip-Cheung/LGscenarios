import type { ReactNode } from 'react'
import styles from './screens.module.css'

interface PageShellProps {
  title?: string
  children: ReactNode
}

/** Quiet label and scenario title above a single card. */
export function PageShell({ title, children }: PageShellProps) {
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <header className={styles.header}>
          {title ? (
            <>
              <p className={styles.eyebrow}>Doorstep practice</p>
              <h1 className={styles.title}>{title}</h1>
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
