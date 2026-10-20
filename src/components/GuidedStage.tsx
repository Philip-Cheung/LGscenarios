import { useId, useState, type ReactNode, type Ref } from 'react'
import { findDiscussionItem, type ChristianHelp, type ScenarioContent, type ScenarioImage } from '../lib/content'
import { scenarioImageUrl } from '../scenarios/catalog'
import type { GuidedEvent, SessionSnapshot } from '../sessions/types'
import type { PendingAction } from '../sessions/useSessionSync'
import { Button, Card, CueTag, StatusMessage } from './ui'
import styles from './screens.module.css'

export interface GuidedStageProps {
  scenario: ScenarioContent
  snapshot: SessionSnapshot
  statusText: string
  /** Live, nothing pending, partner present, and no restart request open. */
  canAct: boolean
  pending: PendingAction | null
  headingRef: Ref<HTMLHeadingElement>
  imageBaseUrl: string
  onSend(event: GuidedEvent, targetId?: string): void
  /** Opens the finish confirmation. */
  onFinish(): void
}

/** The participant's view of the current shared stage, rendered from server state only. */
export function GuidedStage(props: GuidedStageProps) {
  switch (props.snapshot.stage) {
    case 'scene_setup':
      return <SceneSetup {...props} />
    case 'interaction_trigger':
      return <InteractionTrigger {...props} />
    case 'opening_dialogue':
      return <OpeningDialogue {...props} />
    case 'question_selection':
      return <QuestionSelection {...props} />
    case 'discussion':
      return <Discussion {...props} />
    case 'conclusion':
      return null
  }
}

function StageCard({ headingId, turn, children }: { headingId: string; turn: string; children: ReactNode }) {
  return (
    <Card className={styles.enter} aria-labelledby={headingId}>
      <div className={styles.cardBody}>
        {turn ? <p className={styles.turn}>{turn}</p> : null}
        {children}
      </div>
    </Card>
  )
}

function SceneSetup({ scenario, snapshot, statusText, canAct, pending, headingRef, imageBaseUrl, onSend }: GuidedStageProps) {
  const headingId = useId()
  const scene = scenario.roles[snapshot.myRole]
  let waiting = ''
  if (snapshot.meReady) waiting = 'Waiting for your partner to get ready…'
  else if (snapshot.partnerReady) waiting = 'Your partner is ready.'

  return (
    <StageCard headingId={headingId} turn={snapshot.meReady ? 'Partner’s turn' : 'Your turn'}>
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
        {scene.sceneTitle}
      </h1>
      <SceneImage image={scene.image} baseUrl={imageBaseUrl} />
      <p className={styles.text}>{scene.sceneText}</p>
      <div className={styles.goal}>
        <p className={styles.goalLabel}>Your goal</p>
        <p className={styles.text}>{scene.goal}</p>
      </div>
      <div className={styles.footer}>
        <StatusMessage>{statusText || waiting}</StatusMessage>
        {snapshot.meReady ? null : (
          <Button block disabled={!canAct} loading={pending === 'ready'} onClick={() => onSend('ready')}>
            I’m ready
          </Button>
        )}
      </div>
    </StageCard>
  )
}

function InteractionTrigger({ scenario, snapshot, statusText, canAct, pending, headingRef, onSend }: GuidedStageProps) {
  const headingId = useId()
  const trigger = scenario.interactionTrigger
  const initiator = snapshot.myRole === trigger.initiatingRole

  if (initiator) {
    return (
      <StageCard headingId={headingId} turn={snapshot.triggerInitiated ? 'Partner’s turn' : 'Your turn'}>
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.prompt}>
          {trigger.initiatorPrompt}
        </h1>
        <div className={styles.footer}>
          <StatusMessage>
            {statusText || (snapshot.triggerInitiated ? 'Waiting for your partner to respond…' : '')}
          </StatusMessage>
          {snapshot.triggerInitiated ? null : (
            <Button block disabled={!canAct} loading={pending === 'trigger_initiate'} onClick={() => onSend('trigger_initiate')}>
              {trigger.initiatorActionLabel}
            </Button>
          )}
        </div>
      </StageCard>
    )
  }

  return (
    <StageCard headingId={headingId} turn={snapshot.triggerInitiated ? 'Your turn' : 'Partner’s turn'}>
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className={snapshot.triggerInitiated ? styles.prompt : styles.heading}>
        {snapshot.triggerInitiated ? trigger.receiverPrompt : 'Waiting for your partner'}
      </h1>
      {snapshot.triggerInitiated ? null : <p className={styles.muted}>Your partner makes the first move.</p>}
      <div className={styles.footer}>
        <StatusMessage>{statusText}</StatusMessage>
        {snapshot.triggerInitiated ? (
          <Button
            block
            disabled={!canAct}
            loading={pending === 'trigger_acknowledge'}
            onClick={() => onSend('trigger_acknowledge')}
          >
            {trigger.receiverActionLabel}
          </Button>
        ) : null}
      </div>
    </StageCard>
  )
}

function OpeningDialogue({ scenario, snapshot, statusText, canAct, pending, headingRef, onSend }: GuidedStageProps) {
  const headingId = useId()
  const opening = scenario.openingDialogue
  const speaker = snapshot.myRole === opening.speakerRole

  if (speaker) {
    return (
      <StageCard headingId={headingId} turn="Your turn">
        <div className={styles.beat}>
          <CueTag kind="say" />
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.prompt}>
            {opening.script}
          </h1>
        </div>
        <p className={styles.guidance}>Say this in your own words, then continue.</p>
        <div className={styles.footer}>
          <StatusMessage>{statusText}</StatusMessage>
          <Button block disabled={!canAct} loading={pending === 'opening_complete'} onClick={() => onSend('opening_complete')}>
            Continue
          </Button>
        </div>
      </StageCard>
    )
  }

  return (
    <StageCard headingId={headingId} turn="Partner’s turn">
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
        Listen to your partner
      </h1>
      <p className={styles.text}>{opening.listenerPrompt ?? 'Respond naturally, as you would in real life.'}</p>
      <div className={styles.footer}>
        <StatusMessage>{statusText || 'Your partner continues when they’re done.'}</StatusMessage>
      </div>
    </StageCard>
  )
}

function QuestionSelection({ scenario, snapshot, statusText, canAct, pending, headingRef, onSend, onFinish }: GuidedStageProps) {
  const headingId = useId()

  if (snapshot.myRole !== 'missionary') {
    return (
      <StageCard headingId={headingId} turn="Partner’s turn">
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
          Your partner is choosing a question
        </h1>
        <p className={styles.muted}>You’ll see it once they have asked it.</p>
        <div className={styles.footer}>
          <StatusMessage>{statusText}</StatusMessage>
        </div>
      </StageCard>
    )
  }

  return (
    <StageCard headingId={headingId} turn="Your turn">
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
        Choose a question
      </h1>
      <p className={styles.muted}>Pick the topic you want to raise next.</p>
      <ul className={styles.topicList}>
        {scenario.questions.map((question) => (
          <li key={question.id}>
            <button
              type="button"
              className={styles.topic}
              disabled={!canAct}
              onClick={() => onSend('select_question', question.id)}
            >
              {question.topicTag ? <span className={styles.topicTag}>{question.topicTag}</span> : null}
              <span className={styles.topicTitle}>{question.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.footer}>
        <StatusMessage>{statusText || (pending === 'select_question' ? 'Opening the question…' : '')}</StatusMessage>
        <Button variant="secondary" block disabled={!canAct} onClick={onFinish}>
          Finish conversation
        </Button>
      </div>
    </StageCard>
  )
}

function Discussion({ scenario, snapshot, statusText, canAct, pending, headingRef, onSend, onFinish }: GuidedStageProps) {
  const headingId = useId()
  const item = findDiscussionItem(scenario, snapshot.activeQuestionId, snapshot.activeFollowupId)

  if (!item) {
    return (
      <StageCard headingId={headingId} turn="">
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
          This question is not available
        </h1>
        <p className={styles.muted}>Refresh the page to load the latest scenario.</p>
      </StageCard>
    )
  }

  const { question, followUp } = item
  const script = followUp?.missionaryScript ?? question.missionaryScript
  const topic = question.topicTag ?? question.title
  const isMissionary = snapshot.myRole === 'missionary'

  if (isMissionary && !snapshot.questionAsked) {
    return (
      <StageCard headingId={headingId} turn="Your turn">
        <p className={styles.step}>{followUp ? `Follow-up · ${topic}` : topic}</p>
        <div className={styles.beat}>
          <CueTag kind={followUp ? 'challenge' : 'say'} />
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.prompt}>
            {script}
          </h1>
        </div>
        <p className={styles.guidance}>Read it aloud, then tap Question asked.</p>
        <div className={styles.footer}>
          <StatusMessage>{statusText}</StatusMessage>
          <Button block disabled={!canAct} loading={pending === 'question_asked'} onClick={() => onSend('question_asked')}>
            Question asked
          </Button>
          <button
            type="button"
            className={styles.textAction}
            disabled={!canAct}
            onClick={() => onSend('return_to_questions')}
          >
            Choose a different question
          </button>
        </div>
      </StageCard>
    )
  }

  if (isMissionary) {
    const nextFollowUps = (question.followUps ?? []).filter((item) => item.id !== followUp?.id)
    return (
      <StageCard headingId={headingId} turn="Your turn">
        <p className={styles.step}>{topic}</p>
        <div className={styles.beat}>
          <CueTag kind="wait" />
          <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
            Listen to their answer
          </h1>
        </div>
        <div className={styles.asked}>
          <p className={styles.answerLabel}>You asked</p>
          <p className={styles.text}>{script}</p>
        </div>
        {nextFollowUps.length > 0 ? (
          <section className={styles.stack} aria-labelledby={`${headingId}-followups`}>
            <h2 id={`${headingId}-followups`} className={styles.subheading}>
              Follow up
            </h2>
            <ul className={styles.topicList}>
              {nextFollowUps.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={styles.topic}
                    disabled={!canAct}
                    onClick={() => onSend('select_followup', item.id)}
                  >
                    <span className={styles.topicTitle}>{item.label ?? item.missionaryScript}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className={styles.footer}>
          <StatusMessage>{statusText}</StatusMessage>
          <Button
            variant="secondary"
            block
            disabled={!canAct}
            loading={pending === 'return_to_questions'}
            onClick={() => onSend('return_to_questions')}
          >
            Choose another question
          </Button>
          <Button variant="secondary" block disabled={!canAct} onClick={onFinish}>
            Finish conversation
          </Button>
        </div>
      </StageCard>
    )
  }

  if (!snapshot.questionAsked) {
    return (
      <StageCard headingId={headingId} turn="Partner’s turn">
        <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.heading}>
          Listen for your partner’s question
        </h1>
        <p className={styles.muted}>It appears here after they have asked it.</p>
        <div className={styles.footer}>
          <StatusMessage>{statusText}</StatusMessage>
        </div>
      </StageCard>
    )
  }

  return (
    <StageCard headingId={headingId} turn="Your turn to answer">
      <p className={styles.step}>{followUp ? `Follow-up · ${topic}` : topic}</p>
      <h1 id={headingId} ref={headingRef} tabIndex={-1} className={styles.prompt}>
        {script}
      </h1>
      <p className={styles.muted}>Answer in your own words first.</p>
      <AnswerHelp key={`${snapshot.round}:${question.id}:${followUp?.id ?? ''}`} help={followUp?.christian ?? question.christian} />
      <div className={styles.footer}>
        <StatusMessage>{statusText || 'Your partner chooses what comes next.'}</StatusMessage>
      </div>
    </StageCard>
  )
}

/**
 * Optional help for the Christian. Nothing is rendered until requested, so the
 * suggested answer is not in the page or the accessibility tree before Reveal.
 * The parent remounts this per question, round, and role, which hides it again.
 */
function AnswerHelp({ help }: { help: ChristianHelp }) {
  const id = useId()
  const [hintOpen, setHintOpen] = useState(false)
  const [scripturesOpen, setScripturesOpen] = useState(false)
  const [revealed, setRevealed] = useState(false)

  return (
    <div className={styles.help}>
      {help.hint || help.scriptures ? (
        <div className={styles.helpRow}>
          {help.hint ? (
            <button
              type="button"
              className={styles.textAction}
              aria-expanded={hintOpen}
              aria-controls={`${id}-hint`}
              onClick={() => setHintOpen((open) => !open)}
            >
              {hintOpen ? 'Hide hint' : 'Show hint'}
            </button>
          ) : null}
          {help.scriptures ? (
            <button
              type="button"
              className={styles.textAction}
              aria-expanded={scripturesOpen}
              aria-controls={`${id}-scriptures`}
              onClick={() => setScripturesOpen((open) => !open)}
            >
              {scripturesOpen ? 'Hide scripture' : 'Show scripture'}
            </button>
          ) : null}
        </div>
      ) : null}
      <div id={`${id}-hint`}>
        {hintOpen && help.hint ? (
          <div className={styles.answer}>
            <p className={styles.answerLabel}>Hint</p>
            <p className={styles.text}>{help.hint}</p>
          </div>
        ) : null}
      </div>
      <div id={`${id}-scriptures`}>
        {scripturesOpen && help.scriptures ? (
          <div className={styles.answer}>
            <p className={styles.answerLabel}>Scripture</p>
            <ul className={styles.scriptureList}>
              {help.scriptures.map((reference) => (
                <li key={reference}>{reference}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {revealed ? (
        <div className={styles.answer}>
          <p className={styles.answerLabel}>Suggested answer</p>
          <p className={styles.answerText}>{help.hiddenAnswer}</p>
          <button type="button" className={styles.textAction} onClick={() => setRevealed(false)}>
            Hide answer
          </button>
        </div>
      ) : (
        <div className={styles.concealed}>
          <p className={styles.answerLabel}>Suggested answer</p>
          <div className={styles.concealedLines} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <Button variant="secondary" block onClick={() => setRevealed(true)}>
            Reveal answer
          </Button>
        </div>
      )}
    </div>
  )
}

function SceneImage({ image, baseUrl }: { image: ScenarioImage | undefined; baseUrl: string }) {
  const [failed, setFailed] = useState(false)
  if (!image || failed) return null
  return (
    <img
      className={styles.sceneImage}
      src={scenarioImageUrl(baseUrl, image.path)}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
