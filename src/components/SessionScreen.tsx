import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { isConversation, type AnyScenarioContent } from '../lib/content'
import type { SessionApi } from '../sessions/api'
import { clearPointer, writePointer } from '../sessions/pointer'
import type { SessionSnapshot } from '../sessions/types'
import { useSessionSync } from '../sessions/useSessionSync'
import { ConversationNotice, ConversationSession } from './conversation/ConversationSession'
import { EndedCard } from './EndedCard'
import { ENDED_COPY } from './endedCopy'
import { MessageCard } from './MessageCard'
import { SessionView } from './SessionView'

interface SessionScreenProps {
  client: SupabaseClient
  api: SessionApi
  userId: string
  initial: SessionSnapshot
  scenario: AnyScenarioContent
  slug: string
  /** Supabase URL that serves setting images from Storage. */
  imageBaseUrl: string
  /** True when this browser reopened a pair it was already seated in. */
  resumed?: boolean
  onStartOver(): void
  /** `duringPairing` is true when the creator closed the code before anyone joined. */
  onEnded(byPartner: boolean, duringPairing: boolean): void
}

export function SessionScreen({
  client,
  api,
  userId,
  initial,
  scenario,
  slug,
  imageBaseUrl,
  resumed = false,
  onStartOver,
  onEnded,
}: SessionScreenProps) {
  const { snapshot, connection, ended, endedByPartner, pending, notice, lastError, actions, clockOffsetMs } =
    useSessionSync({
      client,
      api,
      sessionId: initial.id,
      userId,
      initial,
    })

  const lastLiveStatus = useRef(initial.status)
  useEffect(() => {
    if (snapshot.status !== 'ended') lastLiveStatus.current = snapshot.status
  }, [snapshot.status])

  useEffect(() => {
    if (ended) clearPointer(slug)
  }, [ended, slug])

  useEffect(() => {
    if (ended === 'ended' || snapshot.status === 'ended') onEnded(endedByPartner, lastLiveStatus.current === 'waiting')
  }, [ended, endedByPartner, onEnded, snapshot.status])

  // Hard mode moves the pair to another scenario; its page resumes this session.
  const navigate = useNavigate()
  const movedTo =
    !ended && snapshot.status !== 'ended' && isConversation(scenario) && snapshot.scenarioId !== scenario.id
      ? snapshot.scenarioId
      : null
  useEffect(() => {
    if (!movedTo) return
    writePointer(movedTo, snapshot.id)
    clearPointer(slug)
    void navigate(`/s/${movedTo}`, { replace: true })
  }, [movedTo, navigate, slug, snapshot.id])

  if (ended === 'ended' || snapshot.status === 'ended' || movedTo) return null
  const outdated = snapshot.scenarioId !== scenario.id || snapshot.scenarioVersion !== scenario.version

  if (isConversation(scenario)) {
    if (ended) {
      const { heading, body } = ENDED_COPY[ended]
      return (
        <ConversationNotice
          subtitle={scenario.title}
          heading={heading}
          body={body}
          actionLabel="Start a new practice"
          onAction={onStartOver}
        />
      )
    }
    if (outdated) {
      return (
        <ConversationNotice
          subtitle={scenario.title}
          heading="Please refresh this page"
          body="This practice uses a different version of the scenario."
          actionLabel="Refresh"
          onAction={() => window.location.reload()}
        />
      )
    }
    return (
      <ConversationSession
        content={scenario}
        snapshot={snapshot}
        connection={connection}
        pending={pending}
        notice={notice}
        lastError={lastError}
        actions={actions}
        clockOffsetMs={clockOffsetMs}
        resumed={resumed}
      />
    )
  }

  if (ended) return <EndedCard reason={ended} onStartOver={onStartOver} />
  if (outdated) {
    return (
      <MessageCard heading="Please refresh this page" actionLabel="Refresh" onAction={() => window.location.reload()}>
        <p>This practice uses a different version of the scenario.</p>
      </MessageCard>
    )
  }
  return (
    <SessionView
      scenario={scenario}
      snapshot={snapshot}
      connection={connection}
      pending={pending}
      notice={notice}
      lastError={lastError}
      actions={actions}
      imageBaseUrl={imageBaseUrl}
      resumed={resumed}
    />
  )
}
