import { useParams } from 'react-router'
import { MessageCard } from '../components/MessageCard'
import { PageShell } from '../components/PageShell'
import { ScenarioFlow } from '../components/ScenarioFlow'
import styles from '../components/screens.module.css'
import { configResult } from '../lib/env'
import { findLatestBundledBySlug } from '../scenarios'

export function ScenarioPage() {
  const { slug = '' } = useParams()
  const bundled = findLatestBundledBySlug(slug)
  if (!bundled) return <NotFoundPage />
  if (!configResult.ok) return <ConfigErrorPage title={bundled.title} problems={configResult.problems} />
  return <ScenarioFlow key={slug} slug={slug} bundledTitle={bundled.title} config={configResult.config} />
}

export function NotFoundPage() {
  return (
    <PageShell>
      <title>Scenario not found · Doorstep practice</title>
      <MessageCard heading="We could not find that scenario">
        <p className={styles.muted}>Check that you opened the full link your group leader shared.</p>
      </MessageCard>
    </PageShell>
  )
}

function ConfigErrorPage({ title, problems }: { title: string; problems: string[] }) {
  return (
    <PageShell title={title}>
      <title>Not configured · Doorstep practice</title>
      <MessageCard heading="Practice is not set up yet">
        <p className={styles.muted}>This site is missing its connection settings. Please let your group leader know.</p>
        <ul className={styles.list}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </MessageCard>
    </PageShell>
  )
}
