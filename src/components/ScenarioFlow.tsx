import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScenarioContent } from '../lib/content'
import type { AppConfig } from '../lib/env'
import { getSupabase } from '../lib/supabase'
import { findLatestBundledBySlug, findScenarioVersion } from '../scenarios'
import { SessionApi } from '../sessions/api'
import { ensureIdentity, getExistingUserId } from '../sessions/identity'
import { messageForError } from '../sessions/messages'
import { clearPointer, readPointer, writePointer } from '../sessions/pointer'
import { resolvePublishedVersion } from '../sessions/scenarioVersion'
import type { Role, SessionSnapshot } from '../sessions/types'
import { EndedCard } from './EndedCard'
import { HumanCheck } from './HumanCheck'
import { JoinForm } from './JoinForm'
import { MessageCard } from './MessageCard'
import { PageShell } from './PageShell'
import { RoleSelect } from './RoleSelect'
import { SessionScreen } from './SessionScreen'
import styles from './screens.module.css'

type Intent = { role: 'missionary' } | { role: 'christian'; code: string }

type Phase =
  | { kind: 'boot' }
  | { kind: 'choose' }
  | { kind: 'join' }
  | { kind: 'captcha'; intent: Intent }
  | { kind: 'session'; userId: string; snapshot: SessionSnapshot; scenario: ScenarioContent }
  | { kind: 'ended'; reason: 'expired' | 'gone' }
  | { kind: 'outdated' }
  | { kind: 'resumeError' }

interface ScenarioFlowProps {
  slug: string
  bundledTitle: string
  config: AppConfig
}

export function ScenarioFlow({ slug, bundledTitle, config }: ScenarioFlowProps) {
  const client = useMemo(() => getSupabase(config), [config])
  const api = useMemo(() => new SessionApi(client), [client])
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' })
  const [busyRole, setBusyRole] = useState<Role | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lastCode, setLastCode] = useState('')
  const [bootAttempt, setBootAttempt] = useState(0)
  const requestRef = useRef<{ key: string; id: string } | null>(null)

  // Resume only after the server confirms this identity is still seated.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const pointer = readPointer(slug)
      if (!pointer) {
        if (!cancelled) setPhase({ kind: 'choose' })
        return
      }
      const userId = await getExistingUserId(client)
      if (cancelled) return
      if (!userId) {
        clearPointer(slug)
        setPhase({ kind: 'choose' })
        return
      }
      const result = await api.getSession(pointer.sessionId)
      if (cancelled) return
      if (result.ok) {
        if (result.session.status === 'ended') {
          clearPointer(slug)
          setNotice('Your partner ended the session.')
          setPhase({ kind: 'choose' })
          return
        }
        const scenario = findScenarioVersion(result.session.scenarioId, result.session.scenarioVersion)
        setPhase(scenario ? { kind: 'session', userId, snapshot: result.session, scenario } : { kind: 'outdated' })
        return
      }
      if (result.error === 'session_expired') {
        clearPointer(slug)
        setPhase({ kind: 'ended', reason: 'expired' })
      } else if (result.error === 'not_found' || result.error === 'not_authenticated') {
        clearPointer(slug)
        setPhase({ kind: 'choose' })
      } else {
        setPhase({ kind: 'resumeError' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [api, client, slug, bootAttempt])

  const proceed = useCallback(
    async (intent: Intent, captchaToken?: string) => {
      const fallback: Phase = intent.role === 'missionary' ? { kind: 'choose' } : { kind: 'join' }
      const fail = (message: string) => {
        setError(message)
        setPhase(fallback)
      }
      setError(null)
      setBusyRole(intent.role)
      try {
        const existing = await getExistingUserId(client)
        if (!existing && config.turnstileSiteKey && !captchaToken) {
          setPhase({ kind: 'captcha', intent })
          return
        }
        const identity = existing ? { ok: true as const, userId: existing } : await ensureIdentity(client, captchaToken)
        if (!identity.ok) {
          fail(messageForError(identity.error))
          return
        }

        const resolved = await resolvePublishedVersion(client, slug)
        if (resolved.status === 'outdated') {
          setPhase({ kind: 'outdated' })
          return
        }
        if (resolved.status !== 'ok') {
          fail(messageForError(resolved.status === 'unavailable' ? 'scenario_unavailable' : 'unavailable'))
          return
        }

        // Reuse the request id when retrying after a lost response so the
        // server returns the pair it may already have created or joined.
        const key = intent.role === 'missionary' ? 'create' : `join:${intent.code}`
        const requestId = requestRef.current?.key === key ? requestRef.current.id : crypto.randomUUID()
        requestRef.current = { key, id: requestId }

        const { scenarioId, version } = resolved.scenario
        const result =
          intent.role === 'missionary'
            ? await api.createPair(scenarioId, version, requestId)
            : await api.joinPair(intent.code, scenarioId, version, requestId)

        if (result.ok) {
          requestRef.current = null
          writePointer(slug, result.session.id)
          setPhase({ kind: 'session', userId: identity.userId, snapshot: result.session, scenario: resolved.scenario })
          return
        }
        if (result.error !== 'unavailable') requestRef.current = null
        fail(messageForError(result.error))
      } finally {
        setBusyRole(null)
      }
    },
    [api, client, config.turnstileSiteKey, slug],
  )

  const startOver = useCallback(() => {
    clearPointer(slug)
    setError(null)
    setNotice(null)
    setPhase({ kind: 'choose' })
  }, [slug])

  const leaveEndedSession = useCallback(
    (byPartner: boolean) => {
      clearPointer(slug)
      setError(null)
      setNotice(byPartner ? 'Your partner ended the session.' : null)
      setPhase({ kind: 'choose' })
    },
    [slug],
  )

  const title = phase.kind === 'session' ? phase.scenario.title : bundledTitle
  const introduction = phase.kind === 'choose' || phase.kind === 'boot'
  const description = introduction ? findLatestBundledBySlug(slug)?.description : undefined

  return (
    <PageShell title={title} description={description} compactTitle={!introduction}>
      <title>{`${title} · Doorstep practice`}</title>
      {renderPhase()}
    </PageShell>
  )

  function renderPhase() {
    switch (phase.kind) {
      case 'boot':
        return <p className={styles.muted} role="status">Loading…</p>
      case 'choose':
        return (
          <RoleSelect
            busyRole={busyRole}
            error={error}
            notice={notice}
            onChoose={(role) => {
              setError(null)
              setNotice(null)
              if (role === 'missionary') void proceed({ role: 'missionary' })
              else setPhase({ kind: 'join' })
            }}
          />
        )
      case 'join':
        return (
          <JoinForm
            key="join"
            initialValue={lastCode}
            busy={busyRole === 'christian'}
            error={error}
            onJoin={(code) => {
              setLastCode(code)
              void proceed({ role: 'christian', code })
            }}
            onBack={() => {
              setError(null)
              setPhase({ kind: 'choose' })
            }}
          />
        )
      case 'captcha':
        return config.turnstileSiteKey ? (
          <HumanCheck
            siteKey={config.turnstileSiteKey}
            onToken={(token) => void proceed(phase.intent, token)}
            onCancel={() => setPhase(phase.intent.role === 'missionary' ? { kind: 'choose' } : { kind: 'join' })}
          />
        ) : null
      case 'session':
        return (
          <SessionScreen
            key={phase.snapshot.id}
            client={client}
            api={api}
            userId={phase.userId}
            initial={phase.snapshot}
            scenario={phase.scenario}
            onStartOver={startOver}
            onEnded={leaveEndedSession}
          />
        )
      case 'ended':
        return <EndedCard reason={phase.reason} onStartOver={startOver} />
      case 'outdated':
        return (
          <MessageCard
            heading="Please refresh this page"
            actionLabel="Refresh"
            onAction={() => window.location.reload()}
            focusOnMount
            level="h1"
          >
            <p className={styles.muted}>A newer version of this scenario is available.</p>
          </MessageCard>
        )
      case 'resumeError':
        return (
          <MessageCard
            heading="Cannot reach the practice service"
            actionLabel="Try again"
            onAction={() => {
              setPhase({ kind: 'boot' })
              setBootAttempt((n) => n + 1)
            }}
            focusOnMount
            level="h1"
          >
            <p className={styles.muted}>Check your connection and try again.</p>
          </MessageCard>
        )
    }
  }
}