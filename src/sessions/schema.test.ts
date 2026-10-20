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
  prompt_index: 0,
  revision: 0,
  round: 1,
  my_role: 'missionary',
  partner_joined: false,
  swap_pending: false,
  partner_fresh: null,
  expires_at: '2026-10-20T12:00:00Z',
  pair_code: 'ABCDEF',
  code_expires_at: '2026-10-20T00:15:00Z',
}

describe('parseRpcResult', () => {
  it('maps a successful result to a camelCase snapshot', () => {
    const result = parseRpcResult({ ok: true, session: state })
    expect(result).toEqual({
      ok: true,
      session: expect.objectContaining({ id: SESSION, myRole: 'missionary', pairCode: 'ABCDEF', partnerFresh: null }),
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
  })
})

describe('snapshotFromRealtimeRow', () => {
  const row = {
    id: SESSION,
    scenario_id: 'sample-doorstep',
    scenario_version: 1,
    missionary_user_id: MISSIONARY,
    christian_user_id: CHRISTIAN,
    status: 'active',
    prompt_index: 2,
    revision: '7',
    round: 1,
    swap_requested_by: null,
    expires_at: '2026-10-20T12:00:00Z',
  }

  it('derives the viewer role and leaves unsent fields undefined', () => {
    const snapshot = snapshotFromRealtimeRow(row, CHRISTIAN)
    expect(snapshot).toMatchObject({ myRole: 'christian', revision: 7, promptIndex: 2, partnerJoined: true })
    expect(snapshot?.pairCode).toBeUndefined()
    expect(snapshot?.partnerFresh).toBeUndefined()
  })

  it('ignores rows for sessions the viewer is not in', () => {
    expect(snapshotFromRealtimeRow(row, OUTSIDER)).toBeNull()
  })

  it('never requests pairing codes over Realtime', () => {
    expect(REALTIME_SESSION_COLUMNS).not.toContain('pair_code')
    expect(REALTIME_SESSION_COLUMNS).toContain('revision')
  })
})
