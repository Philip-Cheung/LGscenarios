import { formatPairCode, isWellFormedPairCode, normalizePairCode, PAIR_CODE_ALPHABET, spellPairCode } from './pairCode'

describe('pair codes', () => {
  it('normalizes case, spaces, and hyphens', () => {
    expect(normalizePairCode(' abc - def ')).toBe('ABCDEF')
  })

  it('accepts only six characters from the unambiguous alphabet', () => {
    expect(isWellFormedPairCode('K7MPQ3')).toBe(true)
    expect(isWellFormedPairCode('K7MPQ')).toBe(false)
    expect(isWellFormedPairCode('K7MPQ0')).toBe(false)
    expect(isWellFormedPairCode('OILK7M')).toBe(false)
  })

  it('excludes easily confused characters', () => {
    for (const confusing of ['0', 'O', '1', 'I', 'L']) expect(PAIR_CODE_ALPHABET).not.toContain(confusing)
  })

  it('formats for display and for screen readers', () => {
    expect(formatPairCode('K7MPQ3')).toBe('K7M-PQ3')
    expect(spellPairCode('K7MPQ3')).toBe('K 7 M P Q 3')
  })
})
