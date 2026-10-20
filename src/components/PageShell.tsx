import type { ReactNode } from 'react'
import styles from './screens.module.css'

/** Centres the single product panel on the page. */
export function PageShell({ children }: { children: ReactNode }) {
  return <main className={styles.page}>{children}</main>
}
