import type { ReactNode } from 'react'
import bubblesUrl from '../assets/conversation-bubbles.svg'
import doorwayUrl from '../assets/doorway.svg'
import type { QuestionIcon } from '../lib/content'
import styles from './screens.module.css'

export type IconKind = QuestionIcon | 'goal'

const ICON_PATHS: Record<IconKind, ReactNode> = {
  chat: <path d="M20 11a8 8 0 0 1-11 7l-6 3 2-6A8 8 0 1 1 20 11Z" />,
  leaf: <path d="M12 21V10M12 15C4 15 4 8 4 6c6 0 8 3 8 7M12 12c0-6 4-8 9-8 0 6-3 10-9 10" />,
  book: <path d="M12 6v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z" />,
  goal: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
}

/** Line icons from the reference; they inherit the surrounding text colour. */
export function Icon({ kind = 'chat', size = 20 }: { kind?: IconKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[kind]}
    </svg>
  )
}

export function DoorArt() {
  return (
    <img
      className={styles.sceneArt}
      src={doorwayUrl}
      alt="An open green door and a leafy plant in warm afternoon light"
      width={400}
      height={200}
    />
  )
}

/** Decorative speech bubbles for waiting, paired, paused, and completion screens. */
export function BubblesArt() {
  return <img className={styles.waitingArt} src={bubblesUrl} alt="" width={210} height={150} />
}

/** Inline so the tick can draw itself when the paired screen appears. */
export function PairCheck() {
  return (
    <svg className={styles.pairSuccess} width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7.5 12 3 3 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Ongoing partner activity. Never implies speech detection. */
export function ActivityDots() {
  return (
    <span className={styles.activityDots} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}
