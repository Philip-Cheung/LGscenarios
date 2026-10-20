import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ScenarioContent } from '../lib/content'
import { coffeeChat, sampleDoorstep, whoIsGod } from '../scenarios/fixtures'
import type { SessionSnapshot } from '../sessions/types'
import type { SessionActions } from '../sessions/useSessionSync'
import { SessionView } from './SessionView'

const snapshot: SessionSnapshot = {
  id: '00000000-0000-4000-8000-000000000000',
  scenarioId: sampleDoorstep.id,
  scenarioVersion: sampleDoorstep.version,
  status: 'active',
  revision: 1,
  round: 1,
  myRole: 'missionary',
  isCreator: true,
  partnerJoined: true,
  swapPending: false,
  restartPending: false,
  restartByMe: false,
  restartRequestedAt: null,
  stage: 'scene_setup',
  meReady: false,
  partnerReady: false,
  activeQuestionId: null,
  answeredQuestionIds: [],
  partnerFresh: true,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  pairCode: null,
  codeExpiresAt: null,
}

const responding: Partial<SessionSnapshot> = { stage: 'response', activeQuestionId: 'hope' }
const hope = sampleDoorstep.questions.find((item) => item.id === 'hope')!

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
  scenario: ScenarioContent = sampleDoorstep,
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

async function openMenu() {
  await userEvent.click(screen.getByLabelText('Session controls'))
}

describe('SessionView while waiting for a partner', () => {
  const waiting: Partial<SessionSnapshot> = {
    status: 'waiting',
    stage: 'paired',
    partnerJoined: false,
    partnerFresh: null,
    pairCode: '482716',
    codeExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the code with both roles, and no session menu before pairing', () => {
    renderView(waiting)
    expect(screen.getByTestId('pair-code')).toHaveTextContent('482 716')
    expect(screen.getByText('Code: 4 8 2 7 1 6')).toBeInTheDocument()
    expect(screen.getByText('Join your partner', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('Waiting for your partner to join')).toBeInTheDocument()
    expect(screen.queryByLabelText('Session controls')).not.toBeInTheDocument()
  })

  it('reminds a creator who reopens the code that the partner joins on their own phone', () => {
    render(
      <SessionView
        scenario={sampleDoorstep}
        snapshot={{ ...snapshot, ...waiting, myRole: 'christian' }}
        connection="live"
        pending={null}
        notice={null}
        actions={makeActions()}
        resumed
      />,
    )
    expect(screen.getByText(/on their own phone and enter this code\./)).toHaveTextContent(
      'Ask your partner to choose Join your partner on their own phone and enter this code.',
    )
    expect(screen.getByTestId('pair-code')).toHaveTextContent('482 716')
    expect(screen.getByText('Your role').parentElement!).toHaveTextContent('Christian')
  })

  it('shows the role the creator chose', () => {
    renderView({ ...waiting, myRole: 'christian' })
    const summary = screen.getByText('Your role').parentElement!
    expect(summary).toHaveTextContent('Christian')
    expect(screen.getByText('Your partner’s role').parentElement!).toHaveTextContent('Mormon missionary')
  })

  it('closes the code with Change roles, without a dialog', async () => {
    const end = vi.fn(async () => true)
    renderView(waiting, makeActions({ end }))
    await userEvent.click(screen.getByRole('button', { name: 'Change roles' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(end).toHaveBeenCalledOnce()
  })

  it('stays on the code and explains when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const end = vi.fn(async () => true)
    renderView(waiting, makeActions({ end }))
    await userEvent.click(screen.getByRole('button', { name: 'Change roles' }))
    expect(end).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Your code cannot be closed until your connection returns.')
    expect(screen.getByTestId('pair-code')).toBeInTheDocument()
  })
})

describe('SessionView paired summary', () => {
  it('lets only the creator start the practice, whatever their role', async () => {
    const send = vi.fn(async () => true)
    const { unmount } = renderView({ status: 'ready', stage: 'paired' }, makeActions({ send }))
    expect(screen.getByRole('heading', { level: 1, name: 'A little practice, together.' })).toBeInTheDocument()
    expect(screen.getByText('A Mormon missionary at your door', { selector: 'strong' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start practice' }))
    expect(send).toHaveBeenCalledWith('start_practice', undefined)
    unmount()

    const joiner = renderView({ status: 'ready', stage: 'paired', myRole: 'christian', isCreator: false })
    expect(screen.queryByRole('button', { name: 'Start practice' })).not.toBeInTheDocument()
    expect(screen.getByText('Your partner will start when you’re both ready.')).toBeInTheDocument()
    joiner.unmount()

    renderView({ status: 'ready', stage: 'paired', myRole: 'christian', isCreator: true })
    expect(screen.getByRole('button', { name: 'Start practice' })).toBeInTheDocument()
  })
})

describe('SessionView progress and session controls', () => {
  it('shows the role and truthful progress', () => {
    renderView({ stage: 'opening_dialogue' })
    expect(screen.getByText('Mormon', { selector: 'b' })).toBeInTheDocument()
    expect(screen.getByText('3 of 6 · Opening')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Practice progress' })).toHaveAttribute('aria-valuenow', '3')
  })

  it('confirms before leaving', async () => {
    const end = vi.fn(async () => true)
    renderView({ stage: 'opening_dialogue' }, makeActions({ end }))
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Leave session' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('This will close the practice for both people.')
    expect(end).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave session' }))
    expect(end).toHaveBeenCalledOnce()
  })

  it('offers Restart practice to either person once the practice is active', async () => {
    const requestRestart = vi.fn(async () => true)
    const { unmount } = renderView({ stage: 'question_selection' }, makeActions({ requestRestart }))
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Restart practice' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start again' }))
    expect(requestRestart).toHaveBeenCalledOnce()
    unmount()

    const christian = renderView({ stage: 'question_selection', myRole: 'christian', isCreator: false })
    await openMenu()
    expect(screen.getByRole('button', { name: 'Restart practice' })).toBeInTheDocument()
    christian.unmount()

    renderView({ status: 'ready', stage: 'scene_setup' })
    expect(screen.queryByRole('button', { name: 'Restart practice' })).not.toBeInTheDocument()
  })

  it('saves the motion preference from the menu', async () => {
    renderView({ stage: 'question_selection' })
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Pause motion' }))
    expect(document.documentElement).toHaveClass('motion-paused')
    expect(window.localStorage.getItem('doorstep:motion-paused')).toBe('1')
    await userEvent.click(screen.getByRole('button', { name: 'Resume motion' }))
    expect(document.documentElement).not.toHaveClass('motion-paused')
  })
})

describe('SessionView scene and readiness', () => {
  it('shows each role its own scene and sends Ready once', async () => {
    const send = vi.fn(async () => true)
    renderView({ status: 'ready' }, makeActions({ send }))
    expect(screen.getByRole('img', { name: /open green door/ })).toBeInTheDocument()
    expect(screen.getByText(sampleDoorstep.roles.missionary.goal)).toBeInTheDocument()
    expect(screen.queryByText(sampleDoorstep.roles.christian.sceneText)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'I’m ready' }))
    expect(send).toHaveBeenCalledWith('ready', undefined)
  })

  it('opens the door once on entry and keeps the same artwork when someone is ready', () => {
    const { rerenderWith } = renderView({ status: 'ready' })
    const door = screen.getByRole('img', { name: /open green door/ })
    expect(door).toHaveClass(/animateDoor/)
    rerenderWith({ status: 'ready', meReady: true })
    expect(screen.getByRole('img', { name: /open green door/ })).toBe(door)
  })

  it('waits for the partner after Ready instead of offering it again', () => {
    renderView({ status: 'ready', myRole: 'christian', meReady: true })
    expect(screen.queryByRole('button', { name: 'I’m ready' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'You’re ready · Waiting for partner' })).toBeDisabled()
  })

  it('omits the illustration for scenarios without one', () => {
    renderView({ status: 'ready' }, makeActions(), coffeeChat)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('lets the missionary begin once both are ready', async () => {
    const send = vi.fn(async () => true)
    const { unmount } = renderView({ stage: 'ready_together', meReady: true, partnerReady: true }, makeActions({ send }))
    await userEvent.click(screen.getByRole('button', { name: 'Begin conversation' }))
    expect(send).toHaveBeenCalledWith('begin', undefined)
    unmount()

    renderView({ stage: 'ready_together', myRole: 'christian', meReady: true, partnerReady: true })
    expect(screen.queryByRole('button', { name: 'Begin conversation' })).not.toBeInTheDocument()
    expect(screen.getByText('Your partner will begin with a short hello.')).toBeInTheDocument()
  })
})

describe('SessionView opening', () => {
  it('gives the missionary the script and the Christian a listening prompt', async () => {
    const send = vi.fn(async () => true)
    const { unmount } = renderView({ stage: 'opening_dialogue' }, makeActions({ send }))
    expect(screen.getByText(`“${sampleDoorstep.openingDialogue.script}”`)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'I’ve said it' }))
    expect(send).toHaveBeenCalledWith('opening_complete', undefined)
    unmount()

    renderView({ stage: 'opening_dialogue', myRole: 'christian' })
    expect(screen.getByRole('heading', { level: 1, name: 'Your partner’s turn' })).toBeInTheDocument()
    expect(screen.queryByText(`“${sampleDoorstep.openingDialogue.script}”`)).not.toBeInTheDocument()
  })
})

describe('SessionView question loop', () => {
  it('keeps the choice on the missionary’s phone until it has been asked', async () => {
    const send = vi.fn(async () => true)
    renderView({ stage: 'question_selection' }, makeActions({ send }))
    const asked = screen.getByRole('button', { name: 'I’ve asked it' })
    expect(asked).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /What gives you hope\?/ }))
    expect(send).not.toHaveBeenCalled()
    await userEvent.click(asked)
    expect(send).toHaveBeenCalledWith('ask_question', 'hope')
  })

  it('marks answered questions and keeps them from being asked again', async () => {
    const send = vi.fn(async () => true)
    renderView({ stage: 'question_selection', answeredQuestionIds: ['hope'] }, makeActions({ send }))
    const hopeRadio = screen.getByRole('radio', { name: /Answered.*What gives you hope\?/ })
    expect(hopeRadio).toBeDisabled()
    expect(screen.getByText('What gives you hope?').closest('label')).toHaveClass(/choiceAnswered/)
    await userEvent.click(hopeRadio)
    expect(screen.getByRole('button', { name: 'I’ve asked it' })).toBeDisabled()

    const other = sampleDoorstep.questions.find((item) => item.id !== 'hope')!
    const otherRadio = screen.getByRole('radio', { name: new RegExp(other.prompt.replace('?', '\\?')) })
    expect(otherRadio).toBeEnabled()
    await userEvent.click(otherRadio)
    await userEvent.click(screen.getByRole('button', { name: 'I’ve asked it' }))
    expect(send).toHaveBeenCalledWith('ask_question', other.id)
  })

  it('makes Move to closing the main action once every question is answered', async () => {
    const send = vi.fn(async () => true)
    const all = sampleDoorstep.questions.map((item) => item.id)
    renderView({ stage: 'question_selection', answeredQuestionIds: all }, makeActions({ send }))
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'I’ve asked it' })).not.toBeInTheDocument()
    expect(screen.getByText('You’ve asked every question. Move to closing when you’re ready.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Move to closing' }))
    expect(send).toHaveBeenCalledWith('move_to_closing', undefined)
  })

  it('lets the missionary move to closing at any time', async () => {
    const send = vi.fn(async () => true)
    renderView({ stage: 'question_selection' }, makeActions({ send }))
    await userEvent.click(screen.getByRole('button', { name: 'Move to closing' }))
    expect(send).toHaveBeenCalledWith('move_to_closing', undefined)
  })

  it('shows the Christian no preview while the missionary chooses', () => {
    renderView({ stage: 'question_selection', myRole: 'christian' })
    expect(screen.getByRole('heading', { level: 1, name: 'Your partner’s turn' })).toBeInTheDocument()
    for (const item of sampleDoorstep.questions) expect(screen.queryByText(item.prompt)).not.toBeInTheDocument()
  })

  it('blurs the example answer for sighted users and hides it from screen readers until revealed', async () => {
    const send = vi.fn(async () => true)
    const { rerenderWith } = renderView({ ...responding, myRole: 'christian' }, makeActions({ send }))
    expect(screen.getByRole('heading', { level: 1, name: 'Respond in your own words.' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Example Christian response' })).toBeInTheDocument()
    expect(screen.getByText(`“${hope.prompt}”`)).toBeInTheDocument()

    const quoted = `“${hope.exampleAnswer}”`
    const copies = screen.getAllByText(quoted)
    expect(copies).toHaveLength(2)
    const blurred = copies.find((node) => node.getAttribute('aria-hidden') === 'true')
    const readable = copies.find((node) => node !== blurred)
    expect(blurred).toBeVisible()
    expect(readable).not.toBeVisible()

    const toggle = screen.getByRole('button', { name: 'Reveal example answer' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide example answer' })).toHaveAttribute('aria-expanded', 'true')
    expect(blurred).not.toBeVisible()
    expect(readable).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'I’ve shared my thoughts' }))
    expect(send).toHaveBeenCalledWith('share_complete', undefined)

    rerenderWith({ round: 2 })
    expect(screen.getByRole('button', { name: 'Reveal example answer' })).toBeInTheDocument()
  })

  it('shows scripture references only after the reveal', async () => {
    renderView({ stage: 'response', activeQuestionId: 'nature-of-god', myRole: 'christian' }, makeActions(), whoIsGod)
    const scripture = screen.getByText(/^Scripture:/)
    expect(scripture).not.toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Reveal example answer' }))
    expect(scripture).toBeVisible()
  })

  it('never shows the example answer to the missionary', () => {
    renderView(responding)
    expect(document.body.textContent).not.toContain(hope.exampleAnswer)
    expect(screen.getByRole('heading', { level: 1, name: 'Make room to listen' })).toBeInTheDocument()
  })
})

describe('SessionView closing and completion', () => {
  it('lets the missionary finish with the closing line', async () => {
    const send = vi.fn(async () => true)
    renderView({ stage: 'closing' }, makeActions({ send }))
    expect(screen.getByText(`“${sampleDoorstep.conclusion.closingPrompt}”`)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Finish practice' }))
    expect(send).toHaveBeenCalledWith('finish', undefined)
  })

  it('offers Practise again and Switch roles to the missionary', async () => {
    const requestRestart = vi.fn(async () => true)
    const requestSwap = vi.fn(async () => true)
    renderView({ status: 'completed', stage: 'conclusion' }, makeActions({ requestRestart, requestSwap }))
    expect(screen.getByRole('heading', { level: 1, name: 'Take a moment to reflect.' })).toBeInTheDocument()
    expect(screen.getByText('Complete', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(sampleDoorstep.conclusion.reflectionPrompt ?? '')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Switch roles' }))
    expect(requestSwap).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Practise again' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start again' }))
    expect(requestRestart).toHaveBeenCalledOnce()
  })

  it('offers the Christian Practise again but not Switch roles', async () => {
    const requestRestart = vi.fn(async () => true)
    renderView({ status: 'completed', stage: 'conclusion', myRole: 'christian' }, makeActions({ requestRestart }))
    expect(screen.queryByRole('button', { name: 'Switch roles' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Practise again' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start again' }))
    expect(requestRestart).toHaveBeenCalledOnce()
  })

  it('asks the Christian to accept a switch', async () => {
    const acceptSwap = vi.fn(async () => true)
    renderView({ status: 'completed', stage: 'conclusion', myRole: 'christian', swapPending: true }, makeActions({ acceptSwap }))
    expect(screen.getByText(/You’d practise as the Mormon missionary/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Switch roles' }))
    expect(acceptSwap).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })
})

describe('SessionView restart request', () => {
  it('lets the person who asked cancel while waiting', async () => {
    const cancelRestart = vi.fn(async () => true)
    renderView(
      {
        ...responding,
        myRole: 'christian',
        restartPending: true,
        restartByMe: true,
        restartRequestedAt: new Date().toISOString(),
      },
      makeActions({ cancelRestart }),
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Waiting for your partner' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    expect(cancelRestart).toHaveBeenCalledOnce()
  })

  it('asks the partner to confirm a restart', async () => {
    const acceptRestart = vi.fn(async () => true)
    renderView(
      { ...responding, myRole: 'christian', restartPending: true, restartRequestedAt: new Date().toISOString() },
      makeActions({ acceptRestart }),
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Start again?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start again' }))
    expect(acceptRestart).toHaveBeenCalledOnce()
  })
})

describe('SessionView when the partner is offline', () => {
  it('pauses the practice and lets the connected player leave without waiting', async () => {
    const end = vi.fn(async () => true)
    render(
      <SessionView
        scenario={sampleDoorstep}
        snapshot={{ ...snapshot, ...responding, partnerFresh: false }}
        connection="live"
        pending={null}
        notice={null}
        lastError="partner_stale"
        actions={makeActions({ end })}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Your partner is offline' })).toBeInTheDocument()
    expect(screen.getByText('Practice paused')).toBeInTheDocument()

    const leave = screen.getAllByRole('button', { name: 'Leave session' }).find((button) => !button.closest('details'))
    await userEvent.click(leave!)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Your partner is offline. This will close the practice for both of you.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave session' }))
    expect(end).toHaveBeenCalledOnce()
  })
})
