const STORAGE_KEY = 'doorstep:motion-paused'
const PAUSED_CLASS = 'motion-paused'

/** The participant's saved choice to pause decorative motion on this device. */
export function readMotionPaused(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Saves the choice and applies it to the whole page. */
export function setMotionPaused(paused: boolean): void {
  document.documentElement.classList.toggle(PAUSED_CLASS, paused)
  try {
    if (paused) window.localStorage.setItem(STORAGE_KEY, '1')
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage can be unavailable (private mode); the choice still applies to this page.
  }
}

/** True when decorative motion should be skipped: the system setting or the saved pause. */
export function prefersReducedMotion(): boolean {
  const system = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return system || readMotionPaused()
}

/** Applies the saved choice before the first render. */
export function applySavedMotionPreference(): void {
  document.documentElement.classList.toggle(PAUSED_CLASS, readMotionPaused())
}
