/**
 * Scenario help text is plain text with two kinds of inline token:
 *
 *   [James 1:5](ref:james-1-5)                 opens the bundled Bible passage
 *   [1832 transcript](https://www.church…)     an external source link
 *
 * Blank lines separate paragraphs. Nothing else is interpreted.
 */

export type RichSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; label: string; id: string }
  | { kind: 'link'; label: string; href: string }

/** Hosts external source links may point to. */
export const LINK_HOSTS = ['www.churchofjesuschrist.org'] as const

const TOKEN = /\[([^\]\n]{1,200})\]\(([^)\s]{1,400})\)/g
const REF_TARGET = /^ref:([a-z0-9]+(?:-[a-z0-9]+)*)$/

function linkTarget(target: string): string | null {
  try {
    const url = new URL(target)
    return url.protocol === 'https:' && (LINK_HOSTS as readonly string[]).includes(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

/** Splits one paragraph into text, passage references, and source links. */
export function parseRichText(text: string): RichSegment[] {
  const segments: RichSegment[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    const [whole, label, target] = match
    const ref = REF_TARGET.exec(target)
    const href = ref ? null : linkTarget(target)
    if (!ref && !href) continue
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) })
    segments.push(ref ? { kind: 'ref', label, id: ref[1] } : { kind: 'link', label, href: href! })
    last = match.index + whole.length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}

export function richParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

/** The text a reader sees, with tokens reduced to their labels. */
export function richTextToPlain(text: string): string {
  return text.replace(TOKEN, (_whole, label: string) => label)
}

/** A one-line plain version, for places that cannot hold buttons such as option labels. */
export function richTextOneLine(text: string): string {
  return richParagraphs(richTextToPlain(text)).join(' ')
}

/** Every passage id referenced in the text. */
export function referencedPassages(text: string): string[] {
  return parseRichText(text).flatMap((segment) => (segment.kind === 'ref' ? [segment.id] : []))
}

/**
 * Problems with the token syntax: a link-shaped token whose target is neither a
 * passage reference nor an allowed https source.
 */
export function richTextProblems(text: string): string[] {
  const problems: string[] = []
  for (const match of text.matchAll(TOKEN)) {
    const target = match[2]
    if (!REF_TARGET.test(target) && !linkTarget(target)) {
      problems.push(`link "${match[1]}" must use ref:<passage-id> or an https link to ${LINK_HOSTS.join(', ')}`)
    }
  }
  return problems
}
