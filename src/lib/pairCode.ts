/** Must match the alphabet in app_private.generate_pair_code(). */
export const PAIR_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const PAIR_CODE_LENGTH = 6
/** Generous enough for "abc - def" style input; the server also caps length. */
export const PAIR_CODE_INPUT_MAX_LENGTH = 12

const VALID_CODE = new RegExp(`^[${PAIR_CODE_ALPHABET}]{${PAIR_CODE_LENGTH}}$`)

/** Uppercases and removes spaces and hyphens. */
export function normalizePairCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase()
}

export function isWellFormedPairCode(normalized: string): boolean {
  return VALID_CODE.test(normalized)
}

/** "ABCDEF" -> "ABC-DEF" for display. */
export function formatPairCode(code: string): string {
  return code.length === PAIR_CODE_LENGTH ? `${code.slice(0, 3)}-${code.slice(3)}` : code
}

/** "ABCDEF" -> "A B C D E F" so screen readers spell it out. */
export function spellPairCode(code: string): string {
  return code.split('').join(' ')
}
