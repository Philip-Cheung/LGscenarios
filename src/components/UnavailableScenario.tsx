import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import wayfindingUrl from '../assets/wayfinding.svg'
import { FALLBACK_SCENARIO } from '../scenarios/fallback'
import { Masthead } from './Masthead'
import styles from './UnavailableScenario.module.css'

/** Recovery page for a link that does not lead to a live scenario. It never redirects or starts a practice. */
export function UnavailableScenario() {
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <div className={styles.page}>
      <title>Scenario not found · Doorstep practice</title>
      <meta name="robots" content="noindex" />
      <Masthead />
      <main className={styles.canvas}>
        <article className={styles.screen} aria-labelledby="unavailable-title">
          <img className={styles.art} src={wayfindingUrl} alt="" width={280} height={180} />
          <h1 id="unavailable-title" ref={headingRef} tabIndex={-1} className={styles.title}>
            We couldn’t find this scenario.
          </h1>
          <p className={styles.text}>
            The link may be incomplete, or the scenario may have moved. You can still practise with{' '}
            {FALLBACK_SCENARIO.name}.
          </p>
          <section className={styles.scenario} aria-label="Available scenario">
            <span className={styles.scenarioIcon} aria-hidden="true">
              <svg
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 6v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z" />
              </svg>
            </span>
            <div>
              <div className={styles.eyebrow}>Available scenario</div>
              <h2 className={styles.scenarioName}>{FALLBACK_SCENARIO.name}</h2>
              <p className={styles.scenarioSubtitle}>{FALLBACK_SCENARIO.subtitle}</p>
            </div>
          </section>
          <Link className={styles.cta} to={`/s/${FALLBACK_SCENARIO.slug}`}>
            Go to {FALLBACK_SCENARIO.name}
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          </Link>
          <p className={styles.help}>
            <strong>Looking for a different scenario?</strong>
            <br />
            Ask your group leader for the latest link.
          </p>
        </article>
      </main>
    </div>
  )
}
