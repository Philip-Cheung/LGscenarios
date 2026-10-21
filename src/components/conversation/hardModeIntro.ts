import introUrl from '../../assets/hard-mode.svg?url'
import posterUrl from '../../assets/hard-mode-poster.svg?url'
import { prefersReducedMotion } from '../../lib/motion'
import styles from './conversation.module.css'

/** The artwork's timeline ends fully black at 2.8 seconds. */
const PLAY_MS = 2800
/** With motion reduced, the still title and caption hold this long. */
const STILL_MS = 700
const FADE_MS = 420
const REDUCED_FADE_MS = 220
/** A missing asset or a conversation that never mounts must not trap the pair behind the intro. */
const WATCHDOG_MS = 8000

let markReady: ((focus: () => void) => void) | null = null

/**
 * Hard mode's comic intro, played on each phone when the pair moves into
 * Hard mode, in place of the doorstep encounter. It is attached to
 * document.body, outside React, so it keeps playing while the app changes to
 * the Hard mode page underneath. It fades once the artwork has played (or
 * Skip is pressed) and the Hard mode conversation has mounted.
 */
export function playHardModeIntro(): void {
  if (markReady) return
  const reduced = prefersReducedMotion()

  const overlay = document.createElement('div')
  overlay.className = styles.hardModeOverlay
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Hard mode. Tougher questions. Stay curious.')
  const art = document.createElement('img')
  art.className = styles.hardModeArt
  art.alt = ''
  art.setAttribute('aria-hidden', 'true')
  const skip = document.createElement('button')
  skip.type = 'button'
  skip.className = styles.hardModeSkip
  skip.textContent = 'Skip animation'
  overlay.append(art, skip)

  // Keep the app out of keyboard and screen reader navigation while the intro plays.
  const background = [...document.body.children].filter(
    (element): element is HTMLElement => element instanceof HTMLElement && !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName),
  )
  const wasInert = background.map((element) => element.inert)
  for (const element of background) element.inert = true
  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.body.append(overlay)
  skip.focus({ preventScroll: true })

  const timers: number[] = []
  let played = false
  let ready = false
  let revealing = false
  let finished = false
  let focusConversation: (() => void) | null = null

  const finish = () => {
    if (finished) return
    finished = true
    for (const timer of timers) window.clearTimeout(timer)
    overlay.remove()
    document.body.style.overflow = previousOverflow
    background.forEach((element, index) => {
      element.inert = wasInert[index]
    })
    markReady = null
    focusConversation?.()
  }
  const reveal = () => {
    if (revealing || finished) return
    revealing = true
    overlay.classList.add(styles.hardModeRevealing)
    timers.push(window.setTimeout(finish, reduced ? REDUCED_FADE_MS : FADE_MS))
  }
  const revealWhenReady = () => {
    if (played && ready) reveal()
  }
  const donePlaying = () => {
    played = true
    revealWhenReady()
  }

  skip.addEventListener('click', donePlaying)
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      donePlaying()
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      skip.focus()
    }
  })
  art.addEventListener('load', () => timers.push(window.setTimeout(donePlaying, reduced ? STILL_MS : PLAY_MS)), { once: true })
  art.addEventListener('error', donePlaying, { once: true })
  art.src = reduced ? posterUrl : introUrl
  timers.push(window.setTimeout(reveal, WATCHDOG_MS))

  markReady = (focus) => {
    ready = true
    focusConversation = focus
    revealWhenReady()
  }
}

/** The Hard mode conversation has mounted; the intro may fade, then `focus` runs. No-op without an intro. */
export function hardModeIntroReady(focus: () => void): void {
  markReady?.(focus)
}
