import { isPartnerAway, mergeSnapshot } from './snapshot'
import type { SessionSnapshot } from './types'

const base: SessionSnapshot = {
  id: '11111111-1111-4111-8111-111111111111',
  scenarioId: 'sample-doorstep',
  scenarioVersion: 1,
  status: 'active',
  revision: 5,
  round: 1,
  myRole: 'missionary',
  isCreator: true,
  partnerJoined: true,
  swapPending: false,
  swapByMe: false,
  swapRequestedAt: null,
  restartPending: false,
  restartByMe: false,
  restartRequestedAt: null,
  stage: 'question_selection',
  meReady: true,
  partnerReady: true,
  activeQuestionId: null,
  answeredQuestionIds: [],
  openingQuestionAsked: false,
  exchange: 'initial',
  turn: 'missionary',
  history: [],
  encounterPhase: null,
  encounterDeadline: null,
  encounterRelaxed: false,
  serverNow: undefined,
  partnerFresh: true,
  expiresAt: '2026-10-20T12:00:00Z',
  pairCode: null,
  codeExpiresAt: null,
}

describe('mergeSnapshot', () => {
  it('ignores an older revision so a slow response cannot roll state back', () => {
    const merged = mergeSnapshot(base, { ...base, revision: 4, stage: 'opening_dialogue' })
    expect(merged).toBe(base)
  })

  it('applies a newer revision', () => {
    const merged = mergeSnapshot(base, { ...base, revision: 6, stage: 'response', activeQuestionId: 'nature-of-god' })
    expect(merged.stage).toBe('response')
    expect(merged.activeQuestionId).toBe('nature-of-god')
    expect(merged.revision).toBe(6)
  })

  it('only refreshes volatile fields at the same revision', () => {
    const merged = mergeSnapshot(base, { ...base, stage: 'opening_dialogue', partnerFresh: false })
    expect(merged.stage).toBe('question_selection')
    expect(merged.partnerFresh).toBe(false)
  })

  it('keeps prior values for fields a Realtime row does not carry', () => {
    const waiting = { ...base, status: 'waiting' as const, pairCode: '482716', codeExpiresAt: '2026-10-20T10:00:00Z' }
    const merged = mergeSnapshot(waiting, {
      ...waiting,
      revision: 6,
      partnerFresh: undefined,
      pairCode: undefined,
      codeExpiresAt: undefined,
    })
    expect(merged.revision).toBe(6)
    expect(merged.partnerFresh).toBe(true)
    expect(merged.pairCode).toBe('482716')
  })

  it('clears the pairing code once the session leaves waiting', () => {
    const waiting = { ...base, status: 'waiting' as const, pairCode: '482716', codeExpiresAt: '2026-10-20T10:00:00Z' }
    const merged = mergeSnapshot(waiting, { ...waiting, status: 'ready', revision: 6, pairCode: undefined })
    expect(merged.pairCode).toBeNull()
    expect(merged.codeExpiresAt).toBeNull()
  })

  it('returns the same object when nothing changed, avoiding re-renders', () => {
    expect(mergeSnapshot(base, { ...base })).toBe(base)
  })

  it('replaces state for a different session', () => {
    const other = { ...base, id: '22222222-2222-4222-8222-222222222222', revision: 1, pairCode: undefined }
    const merged = mergeSnapshot(base, other)
    expect(merged.id).toBe(other.id)
    expect(merged.pairCode).toBeNull()
  })
})

describe('isPartnerAway', () => {
  it('is true only when a joined partner is known to be stale', () => {
    expect(isPartnerAway({ ...base, partnerFresh: false })).toBe(true)
    expect(isPartnerAway({ ...base, partnerFresh: undefined })).toBe(false)
    expect(isPartnerAway({ ...base, partnerJoined: false, partnerFresh: null })).toBe(false)
  })
})
