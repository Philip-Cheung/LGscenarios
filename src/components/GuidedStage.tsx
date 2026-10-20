import { useId, useState, type ReactNode, type Ref } from 'react'
import { findQuestion, type ScenarioContent, type ScenarioImage, type ScenarioQuestion } from '../lib/content'
import { scenarioImageUrl } from '../scenarios/catalog'
import type { GuidedEvent, Role, SessionSnapshot } from '../sessions/types'
import type { PendingAction } from '../sessions/useSessionSync'
import { AppScreen, type ScreenFrame } from './AppScreen'
import { ActivityDots, BubblesArt, DoorArt, Icon, PairCheck } from './art'
import { otherRole } from './roles'
import { Button } from './ui'
import styles from './screens.module.css'

export interface GuidedStageProps {
  scenario: ScenarioContent
  snapshot: SessionSnapshot
  frame: ScreenFrame
  viewKey: string
  canAct: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  /** Supabase URL that serves setting images from Storage. */
  imageBaseUrl: string
  onSend(event: GuidedEvent, targetId?: string): void
}

const DEFAULT_PARTNER_NOTE = 'Take a moment. You don’t need a perfect answer.'
const DEFAULT_LISTENER_PROMPT = 'They’ll start with a short hello. Listen, then let them know you’re ready.'

/** The shared practice, from the paired summary through the closing line. */
export function GuidedStage(props: GuidedStageProps) {
  const { scenario, snapshot } = props
  const isMissionary = snapshot.myRole === 'missionary'
  switch (snapshot.stage) {
    case 'paired':
      return <Paired {...props} />
    case 'scene_setup':
      return <Scene {...props} />
    case 'ready_together':
      return <ReadyTogether {...props} />
    case 'opening_dialogue':
      return isMissionary ? (
        <Opening {...props} />
      ) : (
        <PartnerTurn
          {...props}
          title="Your partner’s turn"
          description={scenario.openingDialogue.listenerPrompt ?? DEFAULT_LISTENER_PROMPT}
          note="This is a practice conversation. You can take your time."
        />
      )
    case 'question_selection':
      return isMissionary ? (
        <Questions {...props} />
      ) : (
        <PartnerTurn
          {...props}
          title="Your partner’s turn"
          description="They’re choosing a question. Listen when they ask it. The question will appear here next."
          active
        />
      )
    case 'response':
      return isMissionary ? (
        <PartnerTurn
          {...props}
          title="Make room to listen"
          description="Your partner is considering your question. Let them finish in their own time."
          note="Curiosity is more helpful than a perfect next line."
        />
      ) : (
        <Response {...props} />
      )
    case 'closing':
      return isMissionary ? (
        <Closing {...props} />
      ) : (
        <PartnerTurn
          {...props}
          title="A moment to wrap up"
          description="Your partner will close the conversation. Thank you for sharing your perspective."
          note="You’ve both made space for a conversation."
        />
      )
    case 'conclusion':
      return null
  }
}

/** The reference "waiting" view shown while the other person speaks or chooses. */
export function PartnerTurn({
  frame,
  viewKey,
  headingRef,
  title,
  description,
  note = DEFAULT_PARTNER_NOTE,
  active = false,
}: Pick<GuidedStageProps, 'frame' | 'viewKey' | 'headingRef'> & {
  title: string
  description: string
  note?: string
  /** Shows the activity dots while the partner is choosing. */
  active?: boolean
}) {
  return (
    <AppScreen {...frame} viewKey={viewKey} waiting note={note}>
      <BubblesArt />
      <span className={styles.connectionTag}>Partner connected</span>
      <h1 ref={headingRef} tabIndex={-1}>
        {title}
      </h1>
      <p>{description}</p>
      {active ? <ActivityDots /> : null}
    </AppScreen>
  )
}

function TurnTag({ children }: { children: ReactNode }) {
  return (
    <span className={styles.turn}>
      <Icon />
      {children}
    </span>
  )
}

function Paired({ scenario, snapshot, frame, viewKey, canAct, pending, headingRef, onSend }: GuidedStageProps) {
  const { isCreator } = snapshot
  return (
    <AppScreen
      {...frame}
      viewKey={viewKey}
      note={
        isCreator
          ? 'You’ll both see the scene before the conversation begins.'
          : 'Your partner will start when you’re both ready.'
      }
      actions={
        isCreator ? (
          <Button disabled={!canAct} loading={pending === 'start_practice'} onClick={() => onSend('start_practice')}>
            Start practice
          </Button>
        ) : undefined
      }
    >
      <BubblesArt />
      <span className={styles.turn}>
        <PairCheck />
        You’re paired
      </span>
      <h1 ref={headingRef} tabIndex={-1}>
        A little practice, together.
      </h1>
      <p>You’ll take turns speaking and listening. There’s no need to get every word right.</p>
      <PairSummary
        rows={[
          ['You’re practising', scenario.roles[snapshot.myRole].label],
          ['Your partner', scenario.roles[otherRole(snapshot.myRole)].label],
          ['Conversation', scenario.title],
        ]}
      />
    </AppScreen>
  )
}

export function PairSummary({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <div className={styles.pairSummary}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  )
}

function Scene({ scenario, snapshot, frame, viewKey, canAct, pending, headingRef, imageBaseUrl, onSend }: GuidedStageProps) {
  const scene = scenario.roles[snapshot.myRole]
  let note: string | undefined
  if (snapshot.meReady) note = 'Your partner can continue when they’re ready.'
  else if (snapshot.partnerReady) note = 'Your partner is ready.'
  return (
    <AppScreen
      {...frame}
      viewKey={viewKey}
      note={note}
      actions={
        snapshot.meReady ? (
          <Button variant="secondary" disabled>
            You’re ready · Waiting for partner
          </Button>
        ) : (
          <Button disabled={!canAct} loading={pending === 'ready'} onClick={() => onSend('ready')}>
            I’m ready
          </Button>
        )
      }
    >
      <SceneArt image={scene.image} illustration={scenario.illustration} baseUrl={imageBaseUrl} />
      <h1 ref={headingRef} tabIndex={-1}>
        {scene.sceneTitle}
      </h1>
      <p>{scene.sceneText}</p>
      <div className={styles.goal}>
        <Icon kind="goal" />
        <div>
          <small>YOUR GOAL</small>
          <p>{scene.goal}</p>
        </div>
      </div>
    </AppScreen>
  )
}

function ReadyTogether({ scenario, snapshot, frame, viewKey, canAct, pending, headingRef, onSend }: GuidedStageProps) {
  const isMissionary = snapshot.myRole === 'missionary'
  const roles: readonly Role[] = ['missionary', 'christian']
  return (
    <AppScreen
      {...frame}
      viewKey={viewKey}
      note={isMissionary ? undefined : 'Your partner will begin with a short hello.'}
      actions={
        isMissionary ? (
          <Button disabled={!canAct} loading={pending === 'begin'} onClick={() => onSend('begin')}>
            Begin conversation
          </Button>
        ) : undefined
      }
    >
      <TurnTag>Ready together</TurnTag>
      <h1 ref={headingRef} tabIndex={-1}>
        A moment to settle in.
      </h1>
      <p>This is practice. Speak naturally, listen carefully, and give each other room.</p>
      <div className={styles.readyList}>
        {roles.map((role) => (
          <div key={role}>
            <span>{scenario.roles[role].label}</span>
            <span className={`${styles.connectionTag} ${styles.readyTag}`}>
              <span className={styles.readyDot} aria-hidden="true" />
              Ready
            </span>
          </div>
        ))}
      </div>
      {isMissionary ? <p className={styles.hint}>You’ll begin with a short hello.</p> : null}
    </AppScreen>
  )
}

function Opening({ scenario, frame, viewKey, canAct, pending, headingRef, onSend }: GuidedStageProps) {
  return (
    <AppScreen
      {...frame}
      viewKey={viewKey}
      actions={
        <Button disabled={!canAct} loading={pending === 'opening_complete'} onClick={() => onSend('opening_complete')}>
          I’ve said it
        </Button>
      }
    >
      <TurnTag>Your turn · Opening</TurnTag>
      <h1 ref={headingRef} tabIndex={-1} className={styles.srOnly}>
        Start with a hello
      </h1>
      <blockquote className={styles.quote}>“{scenario.openingDialogue.script}”</blockquote>
      <p>Try it in your own words.</p>
      <p className={styles.hint}>Continue when you’ve finished speaking.</p>
    </AppScreen>
  )
}

function Questions({ scenario, snapshot, frame, viewKey, canAct, pending, headingRef, onSend }: GuidedStageProps) {
  // The choice stays on the missionary's phone until the question is asked aloud.
  const [selected, setSelected] = useState<string | null>(null)
  const answered = new Set(snapshot.answeredQuestionIds)
  const allAnswered = scenario.questions.every((question) => answered.has(question.id))
  const choice = selected && !answered.has(selected) ? selected : null
  const moveToClosing = (
    <Button
      variant={allAnswered ? 'primary' : 'text'}
      disabled={!canAct}
      loading={pending === 'move_to_closing'}
      onClick={() => onSend('move_to_closing')}
    >
      Move to closing
    </Button>
  )
  return (
    <AppScreen
      {...frame}
      viewKey={viewKey}
      actions={
        allAnswered ? (
          moveToClosing
        ) : (
          <>
            <Button
              disabled={!canAct || !choice}
              loading={pending === 'ask_question'}
              onClick={() => {
                if (choice) onSend('ask_question', choice)
              }}
            >
              I’ve asked it
            </Button>
            {moveToClosing}
          </>
        )
      }
    >
      <TurnTag>Your turn · Questions</TurnTag>
      <h1 ref={headingRef} tabIndex={-1}>
        What would you like to ask?
      </h1>
      <p>Choose a topic that feels natural.</p>
      <fieldset className={styles.choices}>
        <legend className={styles.srOnly}>Choose a question</legend>
        {scenario.questions.map((question) => {
          const done = answered.has(question.id)
          return (
            <label key={question.id} className={done ? `${styles.choice} ${styles.choiceAnswered}` : styles.choice}>
              <span className={styles.optionIcon}>
                <Icon kind={done ? 'check' : (question.icon ?? 'chat')} />
              </span>
              <span>
                <small>
                  {question.topic}
                  {done ? ' · Answered' : null}
                </small>
                <strong>{question.prompt}</strong>
              </span>
              <input
                type="radio"
                name="question"
                value={question.id}
                disabled={done}
                checked={choice === question.id}
                onChange={() => setSelected(question.id)}
              />
            </label>
          )
        })}
      </fieldset>
      <p className={styles.hint}>
        {allAnswered
          ? 'You’ve asked every question. Move to closing when you’re ready.'
          : 'Say your question aloud, then continue.'}
      </p>
    </AppScreen>
  )
}

function Response({ scenario, snapshot, frame, viewKey, canAct, pending, headingRef, onSend }: GuidedStageProps) {
  const question = findQuestion(scenario, snapshot.activeQuestionId)
  return (
    <AppScreen
      {...frame}
      viewKey={viewKey}
      actions={
        <Button disabled={!canAct} loading={pending === 'share_complete'} onClick={() => onSend('share_complete')}>
          I’ve shared my thoughts
        </Button>
      }
    >
      <TurnTag>Your turn · Response</TurnTag>
      <h1 ref={headingRef} tabIndex={-1}>
        Respond in your own words.
      </h1>
      {question ? (
        <div className={styles.conversation}>
          <small>Your partner asked</small>
          <blockquote>“{question.prompt}”</blockquote>
        </div>
      ) : null}
      <p>Explain what you believe. If you need a starting point, you can reveal an example below.</p>
      {question ? <ExampleAnswer question={question} /> : null}
    </AppScreen>
  )
}

/**
 * The example answer is real text, blurred until revealed. The blurred copy is
 * hidden from assistive technology; the readable copy is hidden until revealed.
 */
function ExampleAnswer({ question }: { question: ScenarioQuestion }) {
  const id = useId()
  const [revealed, setRevealed] = useState(false)
  return (
    <aside className={styles.exampleAnswer} aria-label="Example Christian response">
      <div className={styles.exampleHeading}>Example Christian response</div>
      <p className={styles.hint}>One possible response. Make it your own.</p>
      <p className={styles.exampleBlur} aria-hidden="true" hidden={revealed}>
        “{question.exampleAnswer}”
      </p>
      <div id={id} hidden={!revealed}>
        <p className={styles.exampleText}>“{question.exampleAnswer}”</p>
        {question.scriptures ? <p className={styles.hint}>Scripture: {question.scriptures.join(' · ')}</p> : null}
      </div>
      <Button
        variant="text"
        className={styles.exampleToggle}
        aria-expanded={revealed}
        aria-controls={id}
        onClick={() => setRevealed((value) => !value)}
      >
        {revealed ? 'Hide example answer' : 'Reveal example answer'}
      </Button>
    </aside>
  )
}

function Closing({ scenario, frame, viewKey, canAct, pending, headingRef, onSend }: GuidedStageProps) {
  return (
    <AppScreen
      {...frame}
      viewKey={viewKey}
      actions={
        <Button disabled={!canAct} loading={pending === 'finish'} onClick={() => onSend('finish')}>
          Finish practice
        </Button>
      }
    >
      <TurnTag>Your turn · Closing</TurnTag>
      <h1 ref={headingRef} tabIndex={-1}>
        End with a little kindness.
      </h1>
      <blockquote className={styles.quote}>“{scenario.conclusion.closingPrompt}”</blockquote>
      <p>Use your own words, then finish together.</p>
    </AppScreen>
  )
}

/** A role's own image when set, otherwise the scenario illustration, otherwise nothing. */
function SceneArt({
  image,
  illustration,
  baseUrl,
}: {
  image: ScenarioImage | undefined
  illustration: ScenarioContent['illustration']
  baseUrl: string
}) {
  const [failed, setFailed] = useState(false)
  if (image && !failed) {
    return (
      <img
        className={`${styles.sceneArt} ${styles.sceneImage}`}
        src={scenarioImageUrl(baseUrl, image.path)}
        alt={image.alt}
        decoding="async"
        onError={() => setFailed(true)}
      />
    )
  }
  return illustration === 'doorway' ? <DoorArt /> : null
}
