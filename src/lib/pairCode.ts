/** Must match app_private.generate_pair_code(): six digits. */
export const PAIR_CODE_LENGTH = 6
/** Generous enough for "482 716" or "482-716" style input; the server also caps length. */
export const PAIR_CODE_INPUT_MAX_LENGTH = 12

const VALID_CODE = new RegExp(`^[0-9]{${PAIR_CODE_LENGTH}}$`)

/** Removes spaces and hyphens. */
export function normalizePairCode(input: string): string {
  return input.replace(/[\s-]/g, '')
}

export function isWellFormedPairCode(normalized: string): boolean {
  return VALID_CODE.test(normalized)
}

/** "482716" -> "482 716" for display. */
export function formatPairCode(code: string): string {
  return code.length === PAIR_CODE_LENGTH ? `${code.slice(0, 3)} ${code.slice(3)}` : code
}

/** "482716" -> "4 8 2 7 1 6" so screen readers read each digit. */
export function spellPairCode(code: string): string {
  return code.split('').join(' ')
}
