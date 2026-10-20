import { useId, useState, type Ref } from 'react'
import type { ScenarioContent } from '../lib/content'
import type { PendingAction } from '../sessions/useSessionSync'
import type { Role } from '../sessions/types'
import { Button, Card, StatusMessage } from './ui'
import { ROLE_LABELS } from './roles'
import styles from './screens.module.css'

export interface PromptCardProps {
  scenario: ScenarioContent
  role: Role
  promptIndex: number
  statusText: string
  canAct: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  onBack(): void
  onNext(): void
  onFinish(): void
}

/**
 * One prompt per screen. The parent remounts this card (via `key`) whenever
 * the prompt, round, or role changes, which also hides the answer again.
 */
export function PromptCard({
  scenario,
  role,
  promptIndex,
  statusText,
  canAct,
  pending,
  headingRef,
  onBack,
  onNext,
  onFinish,
}: PromptCardProps) {
  const [answerOpen, setAnswerOpen] = useState(false)
  const answerId = useId()
  const total = scenario.prompts.length
  const prompt = scenario.prompts[Math.min(promptIndex, total - 1)]
  const isFirst = promptIndex === 0
  const isLast = promptIndex >= total - 1

  return (
    <Card aria-labelledby={`${answerId}-heading`}>
      <div className={styles.cardBody}>
        <p className={styles.meta}>
          <span>{ROLE_LABELS[role]}</span>
          <span>
            {promptIndex + 1} of {total}
          </span>
        </p>
        <p className={styles.step}>{prompt.label}</p>
        <h2 id={`${answerId}-heading`} ref={headingRef} tabIndex={-1} className={styles.prompt}>
          {prompt.text}
        </h2>

        {role === 'christian' ? (
          <div className={styles.stack}>
            <Button
              variant="secondary"
              aria-expanded={answerOpen}
              aria-controls={answerId}
              onClick={() => setAnswerOpen((open) => !open)}
            >
              {answerOpen ? 'Hide answer' : 'Show answer'}
            </Button>
            <div id={answerId} className={styles.answer} hidden={!answerOpen}>
              <p className={styles.answerLabel}>Suggested answer</p>
              <p className={styles.answerText}>{prompt.suggestedAnswer}</p>
              {prompt.scriptureReference ? <p className={styles.answerLabel}>{prompt.scriptureReference}</p> : null}
            </div>
          </div>
        ) : null}

        <div className={styles.footer}>
          <StatusMessage>{statusText}</StatusMessage>
          {role === 'missionary' ? (
            <>
              <p className={styles.muted}>Wait for your partner to answer.</p>
              <div className={styles.nav}>
                <Button
                  variant="secondary"
                  disabled={isFirst || !canAct}
                  loading={pending === 'back'}
                  onClick={onBack}
                >
                  Back
                </Button>
                {isLast ? (
                  <Button disabled={!canAct} loading={pending === 'finish'} onClick={onFinish}>
                    Finish
                  </Button>
                ) : (
                  <Button disabled={!canAct} loading={pending === 'next'} onClick={onNext}>
                    Next
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className={`${styles.muted} ${styles.reserved}`}>Your partner controls next and back.</p>
          )}
        </div>
      </div>
    </Card>
  )
}
