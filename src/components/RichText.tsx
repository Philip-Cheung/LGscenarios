import { createContext, Fragment, useContext, useState, type ReactNode } from 'react'
import type { ScenarioBible } from '../lib/content'
import { parseRichText, richParagraphs, type RichSegment } from '../lib/richText'
import { PassageReader } from './PassageReader'
import styles from './RichText.module.css'

type OpenPassage = (referenceId: string) => void

const PassageContext = createContext<OpenPassage | null>(null)

/**
 * Hosts the Bible passage reader for one screen. Render it inside the screen's
 * keyed content so a new shared turn closes any open passage.
 */
export function Passages({ bible, children }: { bible: ScenarioBible | undefined; children: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <PassageContext.Provider value={setOpen}>
      {children}
      {open ? <PassageReader bible={bible} referenceId={open} onClose={() => setOpen(null)} /> : null}
    </PassageContext.Provider>
  )
}

/** Scenario text with passage buttons and source links, split into paragraphs. */
export function RichText({ text, quoted = false }: { text: string; quoted?: boolean }) {
  const paragraphs = richParagraphs(text)
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          {quoted && index === 0 ? '“' : null}
          <Segments segments={parseRichText(paragraph)} />
          {quoted && index === paragraphs.length - 1 ? '”' : null}
        </p>
      ))}
    </>
  )
}

/** Buttons for every passage referenced in the text, for use beside plain text. */
export function PassageButtons({ text }: { text: string }) {
  const refs = richParagraphs(text)
    .flatMap(parseRichText)
    .filter((segment): segment is Extract<RichSegment, { kind: 'ref' }> => segment.kind === 'ref')
  if (refs.length === 0) return null
  return (
    <>
      {refs.map((segment, index) => (
        <span key={`${segment.id}-${index}`}>
          {index > 0 ? ' · ' : null}
          <PassageButton label={segment.label} id={segment.id} />
        </span>
      ))}
    </>
  )
}

function Segments({ segments }: { segments: RichSegment[] }) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <Fragment key={index}>{segment.text}</Fragment>
        if (segment.kind === 'ref') return <PassageButton key={index} label={segment.label} id={segment.id} />
        return (
          <a key={index} className={styles.sourceLink} href={segment.href} target="_blank" rel="noopener noreferrer">
            {segment.label}
            <span aria-hidden="true"> ↗</span>
            <span className={styles.srOnly}> (external source, opens in a new tab)</span>
          </a>
        )
      })}
    </>
  )
}

function PassageButton({ label, id }: { label: string; id: string }) {
  const open = useContext(PassageContext)
  if (!open) return <span>{label}</span>
  return (
    <button type="button" className={styles.passageRef} aria-haspopup="dialog" onClick={() => open(id)}>
      {label}
    </button>
  )
}
