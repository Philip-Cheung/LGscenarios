import { formatPairCode, isWellFormedPairCode, normalizePairCode, spellPairCode } from './pairCode'

describe('pair codes', () => {
  it('removes spaces and hyphens', () => {
    expect(normalizePairCode(' 482 - 716 ')).toBe('482716')
  })

  it('accepts only six digits', () => {
    expect(isWellFormedPairCode('482716')).toBe(true)
    expect(isWellFormedPairCode('012345')).toBe(true)
    expect(isWellFormedPairCode('48271')).toBe(false)
    expect(isWellFormedPairCode('4827160')).toBe(false)
    expect(isWellFormedPairCode('K7MPQ3')).toBe(false)
  })

  it('formats for display and for screen readers', () => {
    expect(formatPairCode('482716')).toBe('482 716')
    expect(spellPairCode('482716')).toBe('4 8 2 7 1 6')
  })
})
