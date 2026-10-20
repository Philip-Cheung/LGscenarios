import { useId, type ReactNode } from 'react'
import bubblesUrl from '../assets/conversation-bubbles.svg'
import type { QuestionIcon } from '../lib/content'
import styles from './screens.module.css'

export type IconKind = QuestionIcon | 'goal' | 'check'

const ICON_PATHS: Record<IconKind, ReactNode> = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
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

/**
 * Inline so the stylesheet can reach the door and floor light. The door opens
 * once when this mounts; re-renders keep the settled frame.
 */
export function DoorArt() {
  const titleId = useId()
  return (
    <svg
      className={`${styles.sceneArt} ${styles.animateDoor}`}
      viewBox="0 0 400 200"
      role="img"
      aria-labelledby={titleId}
    >
      <title id={titleId}>An open green door and a leafy plant in warm afternoon light</title>
      <rect width="400" height="200" fill="#f1e4d1" />
      <path d="M0 160 400 125v75H0Z" fill="#e5cfb5" />
      <rect x="140" y="15" width="125" height="162" rx="3" fill="#fdf8ec" />
      <rect x="154" y="23" width="100" height="151" fill="#c8d2b6" />
      <circle cx="226" cy="58" r="18" fill="#f4d9a0" />
      <path d="m157 132 24-31 20 14 27-40 29 53v47H157Z" fill="#9ba987" />
      <g className={styles.doorLeaf}>
        <path d="m146 16 78 23v148l-78-12Z" fill="#205c50" />
        <path d="m158 36 53 14v48l-53-10Zm0 65 53 10v52l-53-9Z" fill="none" stroke="#729589" strokeWidth="2" />
        <circle cx="207" cy="108" r="3" fill="#e6c28a" />
      </g>
      <path className={styles.doorLight} d="m225 176 80 24h-75l-84-25Z" fill="#f9edce" />
      <path d="M83 161V97m0 48-20-18m20 4 21-24m-21 5-13-17" stroke="#526b50" strokeWidth="3" />
      <g fill="#688161">
        <ellipse cx="61" cy="123" rx="7" ry="16" transform="rotate(-40 61 123)" />
        <ellipse cx="104" cy="105" rx="7" ry="17" transform="rotate(38 104 105)" />
        <ellipse cx="69" cy="94" rx="7" ry="15" transform="rotate(-30 69 94)" />
        <ellipse cx="85" cy="88" rx="7" ry="16" />
        <ellipse cx="103" cy="139" rx="7" ry="15" transform="rotate(45 103 139)" />
      </g>
      <path d="M63 153h40l-7 32H70Z" fill="#bc8060" />
      <path d="M61 151h44v7H61Z" fill="#ce9775" />
      <path d="M294 164h42v10h-42Z" fill="#b7ac92" />
    </svg>
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
