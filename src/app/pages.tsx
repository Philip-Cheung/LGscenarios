import { useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { LoadingCard, MessageCard } from '../components/MessageCard'
import { PageShell } from '../components/PageShell'
import { ScenarioFlow } from '../components/ScenarioFlow'
import styles from '../components/screens.module.css'
import { configResult, type AppConfig } from '../lib/env'
import { getSupabase } from '../lib/supabase'
import { fetchFeaturedSlug, type FeaturedLookup } from '../scenarios/catalog'

export function ScenarioPage() {
  const { slug = '' } = useParams()
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 64) return <NotFoundPage />
  if (!configResult.ok) return <ConfigErrorPage problems={configResult.problems} />
  return <ScenarioFlow key={slug} slug={slug} config={configResult.config} />
}

/** The bare site address opens the most recently published scenario. */
export function RootPage() {
  if (!configResult.ok) return <ConfigErrorPage problems={configResult.problems} />
  return <FeaturedRedirect config={configResult.config} />
}

function FeaturedRedirect({ config }: { config: AppConfig }) {
  const client = useMemo(() => getSupabase(config), [config])
  const [attempt, setAttempt] = useState(0)
  const [lookup, setLookup] = useState<FeaturedLookup | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchFeaturedSlug(client).then((result) => {
      if (!cancelled) setLookup(result)
    })
    return () => {
      cancelled = true
    }
  }, [client, attempt])

  if (lookup?.status === 'ok') return <Navigate to={`/s/${lookup.slug}`} replace />
  if (lookup?.status === 'none') return <NotFoundPage />
  return (
    <PageShell>
      <title>Doorstep practice</title>
      {lookup?.status === 'error' ? (
        <MessageCard
          heading="Cannot reach the practice service"
          actionLabel="Try again"
          onAction={() => {
            setLookup(null)
            setAttempt((n) => n + 1)
          }}
          focusOnMount
        >
          <p>Check your connection and try again.</p>
        </MessageCard>
      ) : (
        <LoadingCard />
      )}
    </PageShell>
  )
}

export function NotFoundPage() {
  return (
    <PageShell>
      <title>Scenario not found · Doorstep practice</title>
      <MessageCard heading="We could not find that scenario">
        <p>Check that you opened the full link your group leader shared.</p>
      </MessageCard>
    </PageShell>
  )
}

function ConfigErrorPage({ problems }: { problems: string[] }) {
  return (
    <PageShell>
      <title>Not configured · Doorstep practice</title>
      <MessageCard heading="Practice is not set up yet">
        <p>This site is missing its connection settings. Please let your group leader know.</p>
        <ul className={styles.list}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </MessageCard>
    </PageShell>
  )
}
