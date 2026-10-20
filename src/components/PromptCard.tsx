import { useId, useState, type Ref } from 'react'
import type { ScenarioContent } from '../lib/content'
import { answerFor, branchCue, isBranchPrompt, scenarioHasCues, spokenCue, spokenLine, waitText } from '../scenarios/present'
import type { PendingAction } from '../sessions/useSessionSync'
import type { Role } from '../sessions/types'
import { ROLE_LABELS } from './roles'
import { Button, Card, CueTag, StatusMessage } from './ui'
import styles from './screens.module.css'

const GUIDE_STORAGE_KEY = 'dp-script-guide-open'

export interface PromptCardProps {
  scenario: ScenarioContent
  role: Role
  promptIndex: number
  selectedBranchId: string | null
  statusText: string
  canAct: boolean
  canSelect: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  onBack(): void
  onNext(): void
  onFinish(): void
  onSelectBranch(branchId: string): void
}

/**
 * One conversation beat per screen. The parent remounts this card (via `key`)
 * whenever the prompt, round, role, or selected branch changes, which also
 * hides the answer again.
 */
export function PromptCard({
  scenario,
  role,
  promptIndex,
  selectedBranchId,
  statusText,
  canAct,
  canSelect,
  pending,
  headingRef,
  onBack,
  onNext,
  onFinish,
  onSelectBranch,
}: PromptCardProps) {
  const [answerOpen, setAnswerOpen] = useState(false)
  const answerId = useId()
  const total = scenario.prompts.length
  const prompt = scenario.prompts[Math.min(promptIndex, total - 1)]
  const isFirst = promptIndex === 0
  const isLast = promptIndex >= total - 1
  const branch = branchCue(prompt)
  const needsChoice = isBranchPrompt(prompt) && !selectedBranchId
  const spoken = spokenLine(prompt, selectedBranchId)
  const answer = answerFor(prompt, selectedBranchId)
  const showGuide = role === 'missionary' && scenarioHasCues(scenario)

  return (
    <Card className={styles.enter} aria-labelledby={`${answerId}-heading`}>
      <div className={styles.cardBody}>
      <p className={styles.meta}>
        <span>{ROLE_LABELS[role]}</span>
        <span>
          {promptIndex + 1} of {total}
        </span>
      </p>
      <p className={styles.step}>{prompt.label}</p>
      {showGuide ? <ScriptGuide /> : null}

      {role === 'missionary' ? (
        <MissionaryBeat
          prompt={prompt}
          spoken={spoken}
          needsChoice={needsChoice}
          selectedBranchId={selectedBranchId}
          canSelect={canSelect}
          selecting={pending === 'selectBranch'}
          headingId={`${answerId}-heading`}
          headingRef={headingRef}
          onSelectBranch={onSelectBranch}
        />
      ) : (
        <ChristianBeat
          spoken={spoken}
          waiting={Boolean(branch) && !spoken}
          headingId={`${answerId}-heading`}
          headingRef={headingRef}
        />
      )}

      {role === 'christian' && answer ? (
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
            <p className={styles.answerText}>{answer}</p>
            {prompt.scriptureReference ? <p className={styles.answerLabel}>{prompt.scriptureReference}</p> : null}
          </div>
        </div>
      ) : null}

      <div className={styles.footer}>
        <StatusMessage>{statusText}</StatusMessage>
        {role === 'missionary' ? (
          <>
            {needsChoice ? (
              <p className={styles.guidance}>Choose a response before continuing.</p>
            ) : (
              <p className={styles.guidance}>Wait for your partner to answer.</p>
            )}
            <div className={styles.nav}>
              <Button variant="secondary" disabled={isFirst || !canAct} loading={pending === 'back'} onClick={onBack}>
                Back
              </Button>
              {isLast ? (
                <Button disabled={!canAct || needsChoice} loading={pending === 'finish'} onClick={onFinish}>
                  Finish
                </Button>
              ) : (
                <Button disabled={!canAct || needsChoice} loading={pending === 'next'} onClick={onNext}>
                  Next
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className={`${styles.guidance} ${styles.reserved}`}>Your partner moves to the next prompt.</p>
        )}
      </div>
      </div>
    </Card>
  )
}

function MissionaryBeat({
  prompt,
  spoken,
  needsChoice,
  selectedBranchId,
  canSelect,
  selecting,
  headingId,
  headingRef,
  onSelectBranch,
}: {
  prompt: ScenarioContent['prompts'][number]
  spoken: string | null
  needsChoice: boolean
  selectedBranchId: string | null
  canSelect: boolean
  selecting: boolean
  headingId: string
  headingRef: Ref<HTMLHeadingElement>
  onSelectBranch(branchId: string): void
}) {
  const cue = spokenCue(prompt)
  const wait = waitText(prompt)
  const branch = branchCue(prompt)

  if (!prompt.cues) {
    return (
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.prompt}>
        {prompt.text}
      </h1>
    )
  }

  return (
    <>
      {cue ? (
        <div className={styles.beat}>
          <CueTag kind={cue.type} />
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.prompt}>
            {prompt.text}
          </h1>
        </div>
      ) : null}
      {branch ? (
        <div className={styles.beat}>
          <CueTag kind="ifTheySay" />
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.prompt}>
            {needsChoice ? 'Choose the matching response.' : spoken}
          </h1>
          <div className={styles.branches} role="group" aria-label="Choose the matching response">
            {branch.options.map((option) => {
              const selected = option.id === selectedBranchId
              return (
                <button
                  key={option.id}
                  type="button"
                  className={styles.branch}
                  aria-pressed={selected}
                  disabled={!canSelect || selecting}
                  onClick={() => onSelectBranch(option.id)}
                >
                  <span>{option.label}</span>
                  {selected ? <span className={styles.selectedMark}>Selected</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      {wait ? (
        <div className={styles.beat}>
          <CueTag kind="wait" />
          <p className={styles.guidance}>{wait}</p>
        </div>
      ) : null}
    </>
  )
}

function ChristianBeat({
  spoken,
  waiting,
  headingId,
  headingRef,
}: {
  spoken: string | null
  waiting: boolean
  headingId: string
  headingRef: Ref<HTMLHeadingElement>
}) {
  return (
    <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.prompt}>
      {waiting || !spoken ? 'Your partner is choosing a follow-up.' : spoken}
    </h1>
  )
}

function ScriptGuide() {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(GUIDE_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      sessionStorage.setItem(GUIDE_STORAGE_KEY, next ? '1' : '0')
    } catch {
      // The guide still works if storage is unavailable.
    }
  }

  return (
    <div className={open ? styles.guide : undefined}>
      <button type="button" className={styles.textAction} aria-expanded={open} onClick={toggle}>
        {open ? 'Hide script guide' : 'Script guide'}
      </button>
      {open ? (
        <ul className={styles.guideList}>
          <li>
            <strong>SAY</strong> — Read these words aloud to the Christian.
          </li>
          <li>
            <strong>WAIT</strong> — Stop and allow the Christian to respond.
          </li>
          <li>
            <strong>CHALLENGE</strong> — Use this follow-up after hearing their answer.
          </li>
          <li>
            <strong>IF THEY SAY…</strong> — Choose the matching response. Skip the others.
          </li>
        </ul>
      ) : null}
    </div>
  )
}
