import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hardModeIntroReady, playHardModeIntro } from './hardModeIntro'

const intro = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Hard mode. Tougher questions. Stay curious."]')
const art = () => intro()!.querySelector('img')!

describe('Hard mode intro', () => {
  let app: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers()
    app = document.createElement('div')
    document.body.append(app)
  })
  afterEach(() => {
    vi.runAllTimers()
    vi.useRealTimers()
    app.remove()
    window.localStorage.clear()
  })

  it('covers the app, then fades only once it has played and the conversation is ready, and focuses it', () => {
    playHardModeIntro()
    expect(intro()).not.toBeNull()
    expect(app.inert).toBe(true)
    expect(document.activeElement?.textContent).toBe('Skip animation')
    art().dispatchEvent(new Event('load'))
    vi.advanceTimersByTime(3000)
    expect(intro()).not.toBeNull()

    const focus = vi.fn()
    hardModeIntroReady(focus)
    vi.advanceTimersByTime(500)
    expect(intro()).toBeNull()
    expect(app.inert).toBeFalsy()
    expect(focus).toHaveBeenCalledOnce()
  })

  it('ends early on Skip, plays once at a time, and is a no-op for a conversation without an intro', () => {
    hardModeIntroReady(() => {})
    playHardModeIntro()
    playHardModeIntro()
    expect(document.querySelectorAll('[aria-label="Hard mode. Tougher questions. Stay curious."]')).toHaveLength(1)
    hardModeIntroReady(() => {})
    intro()!.querySelector('button')!.click()
    vi.advanceTimersByTime(500)
    expect(intro()).toBeNull()
  })

  it('shows the still poster when motion is paused, and never traps the pair if nothing loads', () => {
    window.localStorage.setItem('doorstep:motion-paused', '1')
    playHardModeIntro()
    expect(art().getAttribute('src')).toContain('hard-mode-poster')
    vi.advanceTimersByTime(8500)
    expect(intro()).toBeNull()
    expect(app.inert).toBeFalsy()
  })
})
