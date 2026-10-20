import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ScenarioContent } from '../lib/content'
import { coffeeChat, whoIsGod } from '../scenarios/fixtures'
import type { SessionSnapshot } from '../sessions/types'
import type { SessionActions } from '../sessions/useSessionSync'
import { SessionView } from './SessionView'

const snapshot: SessionSnapshot = {
  id: '00000000-0000-4000-8000-000000000000',
  scenarioId: whoIsGod.id,
  scenarioVersion: whoIsGod.version,
  status: 'active',
  revision: 1,
  round: 1,
  myRole: 'missionary',
  partnerJoined: true,
  swapPending: false,
  restartPending: false,
  restartRequestedAt: null,
  stage: 'scene_setup',
  meReady: false,
  partnerReady: false,
  triggerInitiated: false,
  activeQuestionId: null,
  activeFollowupId: null,
  questionAsked: false,
  partnerFresh: true,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  pairCode: null,
  codeExpiresAt: null,
}

const discussing: Partial<SessionSnapshot> = { stage: 'discussion', activeQuestionId: 'nature-of-god' }
const question = whoIsGod.questions[0]

function makeActions(overrides: Partial<SessionActions> = {}): SessionActions {
  const noop = async () => true
  return {
    send: noop,
    requestSwap: noop,
    acceptSwap: noop,
    declineSwap: noop,
    regenerateCode: noop,
    end: noop,
    requestRestart: noop,
    acceptRestart: noop,
    declineRestart: noop,
    cancelRestart: noop,
    ...overrides,
  }
}

function renderView(
  overrides: Partial<SessionSnapshot>,
  actions: SessionActions = makeActions(),
  scenario: ScenarioContent = whoIsGod,
) {
  const props = {
    scenario,
    connection: 'live' as const,
    pending: null,
    notice: null,
    actions,
  }
  const view = render(<SessionView {...props} snapshot={{ ...snapshot, ...overrides }} />)
  return {
    ...view,
    rerenderWith: (next: Partial<SessionSnapshot>) =>
      view.rerender(<SessionView {...props} snapshot={{ ...snapshot, ...overrides, ...next }} />),
  }
}

describe('SessionView while waiting for a partner', () => {
  const waiting: Partial<SessionSnapshot> = {
    status: 'waiting',
    partnerJoined: false,
    partnerFresh: null,
    pairCode: 'K7MPQ3',
    codeExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers Back to roles in the card instead of the leave button, and closes the code without a dialog', async () => {
    const end = vi.fn(async () => true)
    renderView(waiting, makeActions({ end }))

    expect(screen.queryByRole('button', { name: 'Leave session' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to roles' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(end).toHaveBeenCalledOnce()
  })

  it('stays on the code and explains when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const end = vi.fn(async () => true)
    renderView(waiting, makeActions({ end }))

    await userEvent.click(screen.getByRole('button', { name: 'Back to roles' }))
    expect(end).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Your code cannot be closed until your connection returns.')
    expect(screen.getByTestId('pair-code')).toBeInTheDocument()
  })
})

describe('SessionView header', () => {
  it('shows the role, truthful progress, and an icon-only leave button that confirms first', async () => {
    const end = vi.fn(async () => true)
    renderView({ stage: 'opening_dialogue' }, makeActions({ end }))

    expect(screen.getByText('Missionary')).toBeInTheDocument()
    expect(screen.getByText('Step 3 of 6 · Opening')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Leave session' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('This ends the scenario for both players.')
    expect(end).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'End session' }))
    expect(end).toHaveBeenCalledOnce()
  })
})

describe('SessionView scene and trigger', () => {
  it('shows each role its own scene and sends Ready once', async () => {
    const send = vi.fn(async () => true)
    renderView({ status: 'ready' }, makeActions({ send }))

    expect(screen.getByRole('heading', { level: 1, name: whoIsGod.roles.missionary.sceneTitle })).toBeInTheDocument()
    expect(screen.queryByText(whoIsGod.roles.christian.sceneText)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'I’m ready' }))
    expect(send).toHaveBeenCalledWith('ready', undefined)
  })

  it('waits for the partner after Ready instead of offering it again', () => {
    renderView({ status: 'ready', myRole: 'christian', meReady: true })
    expect(screen.getByRole('heading', { level: 1, name: whoIsGod.roles.christian.sceneTitle })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'I’m ready' })).not.toBeInTheDocument()
    expect(screen.getByText('Waiting for your partner to get ready…')).toBeInTheDocument()
  })

  it('uses the configured initiator and labels, not a hardcoded knock', async () => {
    const send = vi.fn(async () => true)
    const { unmount } = renderView({ stage: 'interaction_trigger', myRole: 'christian' }, makeActions({ send }), coffeeChat)
    await userEvent.click(screen.getByRole('button', { name: 'Wave them over' }))
    expect(send).toHaveBeenCalledWith('trigger_initiate', undefined)
    expect(screen.queryByText(/knock/i)).not.toBeInTheDocument()
    unmount()

    renderView({ stage: 'interaction_trigger', myRole: 'missionary' }, makeActions(), coffeeChat)
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting for your partner' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Walk over and sit down' })).not.toBeInTheDocument()
  })

  it('lets the receiver respond only after the initiator acts', async () => {
    const send = vi.fn(async () => true)
    renderView({ stage: 'interaction_trigger', myRole: 'christian', triggerInitiated: true }, makeActions({ send }))
    expect(screen.getByRole('heading', { level: 1, name: 'Someone is knocking at your door.' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open the door' }))
    expect(send).toHaveBeenCalledWith('trigger_acknowledge', undefined)
  })
})

describe('SessionView question loop', () => {
  it('lets the missionary pick a question while the Christian sees no preview', async () => {
    const send = vi.fn(async () => true)
    const { unmount } = renderView({ stage: 'question_selection' }, makeActions({ send }))
    await userEvent.click(screen.getByRole('button', { name: /Who is God\?/ }))
    expect(send).toHaveBeenCalledWith('select_question', 'nature-of-god')
    unmount()

    renderView({ stage: 'question_selection', myRole: 'christian' })
    expect(screen.getByRole('heading', { level: 1, name: 'Your partner is choosing a question' })).toBeInTheDocument()
    for (const item of whoIsGod.questions) expect(screen.queryByText(item.title)).not.toBeInTheDocument()
  })

  it('keeps the question from the Christian until the missionary has asked it', () => {
    renderView({ ...discussing, myRole: 'christian' })
    expect(screen.queryByText(question.missionaryScript)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).not.toBeInTheDocument()
  })

  it('renders the hidden answer only after Reveal answer, and hides it again for a new round', async () => {
    const { rerenderWith } = renderView({ ...discussing, myRole: 'christian', questionAsked: true })
    expect(screen.getByRole('heading', { level: 1, name: question.missionaryScript })).toBeInTheDocument()
    expect(screen.queryByText(question.christian.hiddenAnswer)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(question.christian.hiddenAnswer)

    await userEvent.click(screen.getByRole('button', { name: 'Show hint' }))
    expect(screen.getByText(question.christian.hint ?? '')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
    expect(screen.getByText(question.christian.hiddenAnswer)).toBeInTheDocument()

    rerenderWith({ round: 2 })
    expect(screen.queryByText(question.christian.hiddenAnswer)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeInTheDocument()
  })

  it('never shows the Christian help to the missionary', () => {
    renderView({ ...discussing, questionAsked: true })
    expect(document.body.textContent).not.toContain(question.christian.hiddenAnswer)
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).not.toBeInTheDocument()
  })

  it('offers follow-ups, another question, and a confirmed finish', async () => {
    const send = vi.fn(async () => true)
    renderView({ ...discussing, questionAsked: true }, makeActions({ send }))

    await userEvent.click(screen.getByRole('button', { name: 'Why does Jesus pray to the Father?' }))
    expect(send).toHaveBeenCalledWith('select_followup', 'jesus-prays')
    await userEvent.click(screen.getByRole('button', { name: 'Choose another question' }))
    expect(send).toHaveBeenCalledWith('return_to_questions', undefined)

    await userEvent.click(screen.getByRole('button', { name: 'Finish conversation' }))
    const dialog = screen.getByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finish' }))
    expect(send).toHaveBeenCalledWith('finish_discussion')
  })
})

describe('SessionView when the partner is disconnected', () => {
  it('lets the connected player end the session without waiting for them', async () => {
    const end = vi.fn(async () => true)
    render(
      <SessionView
        scenario={whoIsGod}
        snapshot={{ ...snapshot, ...discussing, partnerFresh: false }}
        connection="live"
        pending={null}
        notice={null}
        lastError="partner_stale"
        actions={makeActions({ end })}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Your partner is disconnected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Question asked' })).toBeDisabled()
    expect(screen.queryByText('Waiting for your partner to reconnect.')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Your partner is disconnected. This closes the scenario for both of you.')
    expect(dialog).not.toHaveTextContent('Waiting for your partner to reconnect.')

    await userEvent.click(within(dialog).getByRole('button', { name: 'End session' }))
    expect(end).toHaveBeenCalledOnce()
  })
})
