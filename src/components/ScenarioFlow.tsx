import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ScenarioContent } from '../lib/content'
import type { AppConfig } from '../lib/env'
import { getSupabase } from '../lib/supabase'
import { fetchActiveScenario, fetchScenarioVersion } from '../scenarios/catalog'
import { SessionApi } from '../sessions/api'
import { ensureIdentity, getExistingUserId } from '../sessions/identity'
import { messageForError } from '../sessions/messages'
import { clearPointer, readPointer, writePointer } from '../sessions/pointer'
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
  | { kind: 'missing' }
  | { kind: 'resumeError' }

interface ScenarioFlowProps {
  slug: string
  config: AppConfig
}

export function ScenarioFlow({ slug, config }: ScenarioFlowProps) {
  const client = useMemo(() => getSupabase(config), [config])
  const api = useMemo(() => new SessionApi(client), [client])
  const [phase, setPhase] = useState<Phase>({ kind: 'boot' })
  const [landing, setLanding] = useState<ScenarioContent | null>(null)
  const [busyRole, setBusyRole] = useState<Role | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lastCode, setLastCode] = useState('')
  const [bootAttempt, setBootAttempt] = useState(0)
  const requestRef = useRef<{ key: string; id: string } | null>(null)

  // Load the scenario open at this link and, in parallel, resume a pair only
  // after the server confirms this identity is still seated.
  useEffect(() => {
    let cancelled = false

    const resume = async (): Promise<Phase | null> => {
      const pointer = readPointer(slug)
      if (!pointer) return null
      const userId = await getExistingUserId(client)
      if (!userId) {
        clearPointer(slug)
        return null
      }
      const result = await api.getSession(pointer.sessionId)
      if (!result.ok) {
        if (result.error === 'session_expired') {
          clearPointer(slug)
          return { kind: 'ended', reason: 'expired' }
        }
        if (result.error === 'not_found' || result.error === 'not_authenticated') {
          clearPointer(slug)
          return null
        }
        return { kind: 'resumeError' }
      }
      if (result.session.status === 'ended') {
        clearPointer(slug)
        if (!cancelled) setNotice('Your partner ended the session.')
        return null
      }
      const lookup = await fetchScenarioVersion(client, result.session.scenarioId, result.session.scenarioVersion)
      switch (lookup.status) {
        case 'ok':
          return { kind: 'session', userId, snapshot: result.session, scenario: lookup.scenario }
        case 'outdated':
          return { kind: 'outdated' }
        case 'error':
          return { kind: 'resumeError' }
        case 'retired':
        case 'unavailable':
          clearPointer(slug)
          if (!cancelled) setNotice('This practice was updated. Start a new pair.')
          return null
      }
    }

    void (async () => {
      const [lookup, resumed] = await Promise.all([fetchActiveScenario(client, slug), resume()])
      if (cancelled) return
      if (lookup.status === 'ok') setLanding(lookup.scenario)
      if (resumed) {
        setPhase(resumed)
        return
      }
      switch (lookup.status) {
        case 'ok':
          setPhase({ kind: 'choose' })
          break
        case 'outdated':
          setPhase({ kind: 'outdated' })
          break
        case 'error':
          setPhase({ kind: 'resumeError' })
          break
        case 'retired':
        case 'unavailable':
          setPhase({ kind: 'missing' })
          break
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

        // New pairs always use the newest published version for this link.
        const resolved = await fetchActiveScenario(client, slug)
        if (resolved.status === 'outdated') {
          setPhase({ kind: 'outdated' })
          return
        }
        if (resolved.status !== 'ok') {
          fail(messageForError(resolved.status === 'error' ? 'unavailable' : 'scenario_unavailable'))
          return
        }
        setLanding(resolved.scenario)

        // Reuse the request id when retrying after a lost response so the
        // server returns the pair it may already have created or joined.
        const key = intent.role === 'missionary' ? 'create' : `join:${intent.code}`
        const requestId = requestRef.current?.key === key ? requestRef.current.id : crypto.randomUUID()
        requestRef.current = { key, id: requestId }

        const { id: scenarioId, version } = resolved.scenario
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

  const restartBoot = useCallback(() => {
    setPhase({ kind: 'boot' })
    setBootAttempt((n) => n + 1)
  }, [])

  const startOver = useCallback(() => {
    clearPointer(slug)
    setError(null)
    setNotice(null)
    if (landing) setPhase({ kind: 'choose' })
    else restartBoot()
  }, [landing, restartBoot, slug])

  const leaveEndedSession = useCallback(
    (byPartner: boolean) => {
      clearPointer(slug)
      setError(null)
      setNotice(byPartner ? 'Your partner ended the session.' : null)
      if (landing) setPhase({ kind: 'choose' })
      else restartBoot()
    },
    [landing, restartBoot, slug],
  )

  const title = phase.kind === 'session' ? phase.scenario.title : landing?.title
  const introduction = phase.kind === 'choose' || phase.kind === 'boot'
  const description = introduction ? landing?.subtitle : undefined

  return (
    <PageShell title={title} description={description} compactTitle={!introduction}>
      <title>{title ? `${title} · Doorstep practice` : 'Doorstep practice'}</title>
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
            slug={slug}
            imageBaseUrl={config.supabaseUrl}
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
      case 'missing':
        return (
          <MessageCard heading="This scenario is not available" focusOnMount level="h1">
            <p className={styles.muted}>Check that you opened the full link your group leader shared.</p>
          </MessageCard>
        )
      case 'resumeError':
        return (
          <MessageCard
            heading="Cannot reach the practice service"
            actionLabel="Try again"
            onAction={restartBoot}
            focusOnMount
            level="h1"
          >
            <p className={styles.muted}>Check your connection and try again.</p>
          </MessageCard>
        )
    }
  }
}
