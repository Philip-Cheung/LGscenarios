import { Fragment, useContext } from 'react'
import { parseRichText, richParagraphs } from '../../lib/richText'
import styles from './conversation.module.css'
import { OpenPassageContext } from './passageContext'

/**
 * A spoken line with its KJV quotations as inline, tappable text. Only
 * passage references are interactive; anything else renders as its label.
 * Quotations are spans with a button role, because a <button> is laid out as
 * an inline block and a long quotation would not wrap with the sentence.
 */
export function ConversationText({ text }: { text: string }) {
  const open = useContext(OpenPassageContext)
  const paragraphs = richParagraphs(text)
  return (
    <>
      {paragraphs.map((paragraph, p) => (
        <Fragment key={p}>
          {p > 0 ? <br /> : null}
          {parseRichText(paragraph).map((segment, index) => {
            if (segment.kind === 'text') return <Fragment key={index}>{segment.text}</Fragment>
            if (segment.kind === 'link' || !open) return <Fragment key={index}>{segment.label}</Fragment>
            return (
              <span
                key={index}
                role="button"
                tabIndex={0}
                className={styles.verseLink}
                aria-haspopup="dialog"
                aria-label={`${segment.label} — read full KJV passage`}
                onClick={() => open(segment.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  open(segment.id)
                }}
              >
                {segment.label}
              </span>
            )
          })}
        </Fragment>
      ))}
    </>
  )
}
