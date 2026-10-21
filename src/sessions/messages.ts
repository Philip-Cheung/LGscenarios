import type { SessionErrorCode } from './types'

/** Short, user-facing explanations. Never include raw server errors or ids. */
export function messageForError(code: SessionErrorCode): string {
  switch (code) {
    case 'invalid_code':
      return 'That code doesn’t match an open practice. Check your partner’s screen and try again.'
    case 'scenario_mismatch':
      return 'That code is for a different scenario. Make sure you both opened the same link.'
    case 'self_join':
      return 'You created this practice. Your partner needs to enter the code on their phone.'
    case 'rate_limited':
      return 'Too many attempts. Please wait a few minutes and try again.'
    case 'session_expired':
      return 'This practice has ended. Start a new one when you’re ready.'
    case 'not_found':
      return 'This practice is no longer available on this device. Start a new one.'
    case 'scenario_unavailable':
      return 'This scenario is not open for new practices right now.'
    case 'partner_stale':
      return 'Waiting for your partner to reconnect.'
    case 'deadline_passed':
      return 'Missed it? Your pairing is safe. Try again when you’re ready.'
    case 'conflict':
      return 'Your screen was out of date and has been updated. Try again if needed.'
    case 'forbidden':
    case 'invalid_state':
    case 'out_of_range':
      return 'That action is not available right now.'
    case 'not_authenticated':
    case 'auth_failed':
      return 'We could not set up this device. Check your connection and try again.'
    case 'captcha_required':
      return 'Please complete the quick check to continue.'
    case 'invalid_input':
    case 'unavailable':
      return 'Cannot reach the practice service. Check your connection and try again.'
  }
}

/** Shown inside the exit dialog. A lost connection must not look like success. */
export function messageForEndFailure(offline: boolean, code: SessionErrorCode | null): string | null {
  if (offline) return 'You are offline. The shared session cannot be ended until your connection returns.'
  if (!code) return null
  if (code === 'unavailable' || code === 'not_authenticated') {
    return 'The shared session could not be ended. Check your connection and try again.'
  }
  return messageForError(code)
}
