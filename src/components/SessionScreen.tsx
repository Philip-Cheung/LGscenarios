import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect } from 'react'
import type { ScenarioContent } from '../lib/content'
import type { SessionApi } from '../sessions/api'
import { clearPointer } from '../sessions/pointer'
import type { SessionSnapshot } from '../sessions/types'
import { useSessionSync } from '../sessions/useSessionSync'
import { EndedCard } from './EndedCard'
import { MessageCard } from './MessageCard'
import { SessionView } from './SessionView'
import styles from './screens.module.css'

interface SessionScreenProps {
  client: SupabaseClient
  api: SessionApi
  userId: string
  initial: SessionSnapshot
  scenario: ScenarioContent
  slug: string
  /** Supabase URL that serves setting images from Storage. */
  imageBaseUrl: string
  onStartOver(): void
  onEnded(byPartner: boolean): void
}

export function SessionScreen({
  client,
  api,
  userId,
  initial,
  scenario,
  slug,
  imageBaseUrl,
  onStartOver,
  onEnded,
}: SessionScreenProps) {
  const { snapshot, connection, ended, endedByPartner, pending, notice, lastError, actions } = useSessionSync({
    client,
    api,
    sessionId: initial.id,
    userId,
    initial,
  })

  useEffect(() => {
    if (ended) clearPointer(slug)
  }, [ended, slug])

  useEffect(() => {
    if (ended === 'ended' || snapshot.status === 'ended') onEnded(endedByPartner)
  }, [ended, endedByPartner, onEnded, snapshot.status])

  if (ended === 'ended' || snapshot.status === 'ended') return null
  if (ended) return <EndedCard reason={ended} onStartOver={onStartOver} />
  if (snapshot.scenarioId !== scenario.id || snapshot.scenarioVersion !== scenario.version) {
    return (
      <MessageCard heading="Please refresh this page" actionLabel="Refresh" onAction={() => window.location.reload()}>
        <p className={styles.muted}>This pair uses a different version of the scenario.</p>
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
    />
  )
}
