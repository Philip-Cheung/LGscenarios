import type { SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionApi } from './api'
import { getExistingUserId } from './identity'
import { messageForError } from './messages'
import { REALTIME_SESSION_COLUMNS, snapshotFromRealtimeRow } from './schema'
import { mergeSnapshot } from './snapshot'
import type { GuidedEvent, RpcResult, SessionErrorCode, SessionSnapshot } from './types'

export const HEARTBEAT_INTERVAL_MS = 15_000

export type ConnectionState = 'connecting' | 'live' | 'reconnecting'
export type EndReason = 'expired' | 'gone' | 'ended'
export type PendingAction =
  | GuidedEvent
  | 'requestSwap'
  | 'acceptSwap'
  | 'declineSwap'
  | 'regenerate'
  | 'end'
  | 'requestRestart'
  | 'acceptRestart'
  | 'declineRestart'
  | 'cancelRestart'

export interface SessionActions {
  /** Sends one conversation event; `targetId` names the question or follow-up when one is chosen. */
  send(event: GuidedEvent, targetId?: string): Promise<boolean>
  requestSwap(): Promise<boolean>
  acceptSwap(): Promise<boolean>
  declineSwap(): Promise<boolean>
  regenerateCode(): Promise<boolean>
  end(): Promise<boolean>
  requestRestart(): Promise<boolean>
  acceptRestart(): Promise<boolean>
  declineRestart(): Promise<boolean>
  cancelRestart(): Promise<boolean>
}

interface Options {
  client: SupabaseClient
  api: SessionApi
  sessionId: string
  userId: string
  initial: SessionSnapshot
}

/**
 * Keeps one participant's view of a session in sync with Postgres.
 *
 * Order of operations: subscribe to UPDATE events for this row, wait until the
 * subscription is confirmed, then fetch authoritative state. Snapshots are
 * merged by revision so late or out-of-order data never moves state backwards.
 * Mutations are never queued or replayed; controls stay disabled until the
 * subscription and an authoritative read have both recovered.
 */
export function useSessionSync({ client, api, sessionId, userId, initial }: Options) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(initial)
  const snapshotRef = useRef(initial)
  const [channelReady, setChannelReady] = useState(false)
  const [stateFresh, setStateFresh] = useState(true)
  const [everLive, setEverLive] = useState(false)
  const [ended, setEnded] = useState<EndReason | null>(null)
  const [endedByMe, setEndedByMe] = useState(false)
  const terminal: EndReason | null = snapshot.status === 'ended' ? 'ended' : ended
  const endedByPartner = snapshot.status === 'ended' && !endedByMe
  const mounted = useRef(true)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [lastError, setLastError] = useState<SessionErrorCode | null>(null)
  const pendingRef = useRef(false)
  const [notice, setNotice] = useState<string | null>(null)
  const refreshingRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const apply = useCallback((incoming: SessionSnapshot) => {
    if (!mounted.current) return
    setSnapshot((current) => mergeSnapshot(current, incoming))
  }, [])

  const endFor = useCallback((error: SessionErrorCode): boolean => {
    if (error === 'session_expired') {
      setEnded('expired')
      return true
    }
    if (error === 'not_found') {
      setEnded('gone')
      return true
    }
    return false
  }, [])

  /** Renews this seat's heartbeat and reconciles with authoritative state. */
  const refresh = useCallback((): Promise<void> => {
    if (refreshingRef.current) return refreshingRef.current
    const run = (async () => {
      const result = await api.heartbeat(sessionId)
      if (result.ok) {
        apply(result.session)
        setStateFresh(true)
        return
      }
      if (result.session) apply(result.session)
      if (endFor(result.error)) return
      if (result.error === 'not_authenticated') {
        const currentUser = await getExistingUserId(client)
        if (currentUser !== userId) {
          setEnded('gone')
          return
        }
      }
      setStateFresh(false)
    })().finally(() => {
      refreshingRef.current = null
    })
    refreshingRef.current = run
    return run
  }, [api, apply, client, endFor, sessionId, userId])

  // Realtime subscription for this session row only. Membership RLS on the
  // sessions table authorizes delivery; the filter is not a security control.
  useEffect(() => {
    if (terminal) return
    let disposed = false
    const topic = `session-${sessionId}-${crypto.randomUUID().slice(0, 8)}`
    const channel = client
      .channel(topic, { config: { postgres_changes_options: { wait: true } } })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
          select: REALTIME_SESSION_COLUMNS,
        },
        (payload) => {
          const incoming = snapshotFromRealtimeRow(payload.new, userId)
          if (incoming && !disposed) apply(incoming)
        },
      )
      .subscribe((status) => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          setChannelReady(true)
          void refresh()
        } else {
          setChannelReady(false)
        }
      })
    return () => {
      disposed = true
      void client.removeChannel(channel)
    }
  }, [apply, client, terminal, refresh, sessionId, userId])

  // Heartbeat while visible, and recovery after sleep, tab switches, or network loss.
  useEffect(() => {
    if (terminal) return
    const wake = async () => {
      if (document.visibilityState !== 'visible') return
      setStateFresh(false)
      await getExistingUserId(client)
      if (!client.realtime.isConnected()) {
        setChannelReady(false)
        client.realtime.connect()
      }
      await refresh()
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, HEARTBEAT_INTERVAL_MS)
    const onWake = () => void wake()
    const onOffline = () => setStateFresh(false)
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('pageshow', onWake)
    window.addEventListener('online', onWake)
    window.addEventListener('offline', onOffline)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('pageshow', onWake)
      window.removeEventListener('online', onWake)
      window.removeEventListener('offline', onOffline)
    }
  }, [client, terminal, refresh])

  // Token refresh or identity change.
  useEffect(() => {
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (session && session.user.id !== userId)) {
        setEnded('gone')
        return
      }
      // Defer: Supabase recommends not awaiting client calls inside this callback.
      if (event === 'TOKEN_REFRESHED') window.setTimeout(() => void refresh(), 0)
    })
    return () => data.subscription.unsubscribe()
  }, [client, refresh, userId])

  // Expiry is enforced by the server; this only updates an open screen promptly.
  useEffect(() => {
    if (terminal) return
    const remaining = Date.parse(snapshot.expiresAt) - Date.now()
    if (Number.isNaN(remaining)) return
    const timer = window.setTimeout(() => setEnded('expired'), Math.max(0, Math.min(remaining, 2 ** 31 - 1)))
    return () => window.clearTimeout(timer)
  }, [terminal, snapshot.expiresAt])

  const live = channelReady && stateFresh && !terminal
  if (live && !everLive) setEverLive(true)

  const run = useCallback(
    async (action: PendingAction, op: (current: SessionSnapshot) => Promise<RpcResult>): Promise<boolean> => {
      if (pendingRef.current) return false
      pendingRef.current = true
      setPending(action)
      setNotice(null)
      setLastError(null)
      try {
        const result = await op(snapshotRef.current)
        if (!mounted.current) return false
        if (result.session) apply(result.session)
        if (result.ok) {
          setStateFresh(true)
          return true
        }
        setLastError(result.error)
        if (endFor(result.error)) return false
        if (result.error === 'partner_stale') return false
        setNotice(messageForError(result.error))
        if (result.error === 'unavailable' || result.error === 'not_authenticated') {
          // The command may have committed before the response was lost; reread.
          setStateFresh(false)
          void refresh()
        }
        return false
      } finally {
        pendingRef.current = false
        setPending(null)
      }
    },
    [apply, endFor, refresh],
  )

  const actions = useMemo<SessionActions>(
    () => ({
      send: (event: GuidedEvent, targetId?: string) =>
        run(event, (s) => api.guidedEvent(s.id, event, targetId ?? null, s.revision)),
      requestSwap: () => run('requestSwap', (s) => api.requestSwap(s.id, s.revision)),
      acceptSwap: () => run('acceptSwap', (s) => api.respondSwap(s.id, true, s.revision)),
      declineSwap: () => run('declineSwap', (s) => api.respondSwap(s.id, false, s.revision)),
      regenerateCode: () => run('regenerate', (s) => api.regeneratePairCode(s.id)),
      end: () =>
        run('end', async (s) => {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return { ok: false, error: 'unavailable', session: s }
          }
          setEndedByMe(true)
          const result = await api.endSession(s.id, s.revision)
          if (!result.ok && result.session?.status !== 'ended' && result.error !== 'unavailable') {
            setEndedByMe(false)
          }
          return result
        }),
      requestRestart: () => run('requestRestart', (s) => api.requestRestart(s.id, s.revision)),
      acceptRestart: () => run('acceptRestart', (s) => api.respondRestart(s.id, true, s.revision)),
      declineRestart: () => run('declineRestart', (s) => api.respondRestart(s.id, false, s.revision)),
      cancelRestart: () => run('cancelRestart', (s) => api.cancelRestart(s.id, s.revision)),
    }),
    [api, run],
  )

  const connection: ConnectionState = live ? 'live' : everLive ? 'reconnecting' : 'connecting'

  return { snapshot, connection, ended: terminal, endedByPartner, pending, notice, lastError, actions }
}
