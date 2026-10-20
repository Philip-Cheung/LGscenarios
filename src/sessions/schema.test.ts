import { parseRpcResult, REALTIME_SESSION_COLUMNS, snapshotFromRealtimeRow } from './schema'

const MISSIONARY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CHRISTIAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OUTSIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SESSION = '11111111-1111-4111-8111-111111111111'

const state = {
  id: SESSION,
  scenario_id: 'sample-doorstep',
  scenario_version: 1,
  status: 'waiting',
  revision: 0,
  round: 1,
  my_role: 'missionary',
  is_creator: true,
  partner_joined: false,
  swap_pending: false,
  restart_pending: false,
  restart_by_me: false,
  restart_requested_at: null,
  stage: 'paired',
  my_ready: false,
  partner_ready: false,
  active_question_id: null,
  partner_fresh: null,
  expires_at: '2026-10-20T12:00:00Z',
  pair_code: '482716',
  code_expires_at: '2026-10-20T00:15:00Z',
}

describe('parseRpcResult', () => {
  it('maps a successful result to a camelCase snapshot', () => {
    const result = parseRpcResult({ ok: true, session: state })
    expect(result).toEqual({
      ok: true,
      session: expect.objectContaining({ id: SESSION, myRole: 'missionary', isCreator: true, pairCode: '482716', partnerFresh: null }),
    })
  })

  it('keeps known error codes with the current session', () => {
    const result = parseRpcResult({ ok: false, error: 'conflict', session: state })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('conflict')
      expect(result.session?.id).toBe(SESSION)
    }
  })

  it('turns unknown errors and malformed payloads into unavailable', () => {
    expect(parseRpcResult({ ok: false, error: 'boom' })).toEqual({ ok: false, error: 'unavailable', session: null })
    expect(parseRpcResult(null)).toEqual({ ok: false, error: 'unavailable', session: null })
    expect(parseRpcResult({ ok: true, session: { ...state, pair_code: '<script>' } }).ok).toBe(false)
    expect(parseRpcResult({ ok: true, session: { ...state, pair_code: 'K7MPQ3' } }).ok).toBe(false)
    expect(parseRpcResult({ ok: true, session: { ...state, active_question_id: '../etc' } }).ok).toBe(false)
  })

  it('rejects stages from before the warm-coach flow', () => {
    expect(parseRpcResult({ ok: true, session: { ...state, stage: 'discussion' } }).ok).toBe(false)
    expect(parseRpcResult({ ok: true, session: { ...state, stage: 'ready_together' } }).ok).toBe(true)
  })
})

describe('snapshotFromRealtimeRow', () => {
  const row = {
    id: SESSION,
    scenario_id: 'sample-doorstep',
    scenario_version: 1,
    missionary_user_id: MISSIONARY,
    christian_user_id: CHRISTIAN,
    creator_user_id: CHRISTIAN,
    creator_role: 'christian',
    status: 'active',
    revision: '7',
    round: 1,
    swap_requested_by: null,
    restart_requested_by: null,
    restart_requested_at: null,
    stage: 'response',
    missionary_ready: true,
    christian_ready: false,
    active_question_id: 'nature-of-god',
    expires_at: '2026-10-20T12:00:00Z',
  }

  it('derives the viewer role and leaves unsent fields undefined', () => {
    const snapshot = snapshotFromRealtimeRow(row, CHRISTIAN)
    expect(snapshot).toMatchObject({
      myRole: 'christian',
      revision: 7,
      stage: 'response',
      activeQuestionId: 'nature-of-god',
      partnerJoined: true,
    })
    expect(snapshot?.pairCode).toBeUndefined()
    expect(snapshot?.partnerFresh).toBeUndefined()
  })

  it('maps ready flags to the viewer, so each phone knows whose tap is missing', () => {
    expect(snapshotFromRealtimeRow(row, MISSIONARY)).toMatchObject({ meReady: true, partnerReady: false })
    expect(snapshotFromRealtimeRow(row, CHRISTIAN)).toMatchObject({ meReady: false, partnerReady: true })
  })

  it('marks the creator and whose restart request it is', () => {
    const asked = { ...row, restart_requested_by: CHRISTIAN, restart_requested_at: new Date().toISOString() }
    expect(snapshotFromRealtimeRow(asked, CHRISTIAN)).toMatchObject({ isCreator: true, restartPending: true, restartByMe: true })
    expect(snapshotFromRealtimeRow(asked, MISSIONARY)).toMatchObject({ isCreator: false, restartPending: true, restartByMe: false })
  })

  it('gives a waiting creator the role they chose', () => {
    const waiting = { ...row, status: 'waiting', christian_user_id: null, missionary_user_id: CHRISTIAN, stage: 'paired' }
    expect(snapshotFromRealtimeRow(waiting, CHRISTIAN)).toMatchObject({ myRole: 'christian', isCreator: true })
  })

  it('ignores rows for sessions the viewer is not in', () => {
    expect(snapshotFromRealtimeRow(row, OUTSIDER)).toBeNull()
  })

  it('never requests pairing codes over Realtime', () => {
    expect(REALTIME_SESSION_COLUMNS).not.toContain('pair_code')
    expect(REALTIME_SESSION_COLUMNS).toContain('revision')
    expect(REALTIME_SESSION_COLUMNS).toContain('creator_role')
    expect(REALTIME_SESSION_COLUMNS).not.toContain('trigger_initiated')
  })
})
