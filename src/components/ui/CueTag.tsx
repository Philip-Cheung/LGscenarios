import styles from './CueTag.module.css'

const LABELS = {
  say: 'SAY',
  wait: 'WAIT',
  challenge: 'CHALLENGE',
  ifTheySay: 'IF THEY SAY…',
} as const

export type CueTagKind = keyof typeof LABELS

/** Noninteractive stage direction. Meaning is in the text, not the colour. */
export function CueTag({ kind }: { kind: CueTagKind }) {
  return <span className={styles.tag}>{LABELS[kind]}</span>
}
