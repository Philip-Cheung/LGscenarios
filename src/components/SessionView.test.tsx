import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sampleDoorstepV2 } from '../scenarios/sample-doorstep.v2'
import type { SessionSnapshot } from '../sessions/types'
import type { SessionActions } from '../sessions/useSessionSync'
import { SessionView } from './SessionView'

const snapshot: SessionSnapshot = {
  id: '00000000-0000-4000-8000-000000000000',
  scenarioId: sampleDoorstepV2.scenarioId,
  scenarioVersion: sampleDoorstepV2.version,
  status: 'active',
  promptIndex: 0,
  revision: 1,
  round: 1,
  myRole: 'missionary',
  partnerJoined: true,
  swapPending: false,
  restartPending: false,
  restartRequestedAt: null,
  selectedBranchId: null,
  partnerFresh: false,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  pairCode: null,
  codeExpiresAt: null,
}

function actions(end: SessionActions['end']): SessionActions {
  const noop = async () => true
  return {
    start: noop,
    next: noop,
    back: noop,
    finish: noop,
    requestSwap: noop,
    acceptSwap: noop,
    declineSwap: noop,
    regenerateCode: noop,
    end,
    requestRestart: noop,
    acceptRestart: noop,
    declineRestart: noop,
    cancelRestart: noop,
    selectBranch: noop,
  }
}

describe('SessionView while waiting for a partner', () => {
  const waiting: SessionSnapshot = {
    ...snapshot,
    status: 'waiting',
    partnerJoined: false,
    partnerFresh: null,
    pairCode: 'K7MPQ3',
    codeExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  }

  function renderWaiting(end: SessionActions['end']) {
    render(
      <SessionView
        scenario={sampleDoorstepV2}
        snapshot={waiting}
        connection="live"
        pending={null}
        notice={null}
        actions={actions(end)}
      />,
    )
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('offers Back to roles in the card instead of Exit, and closes the code without a dialog', async () => {
    const end = vi.fn(async () => true)
    renderWaiting(end)

    expect(screen.queryByRole('button', { name: 'Exit' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to roles' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(end).toHaveBeenCalledOnce()
  })

  it('stays on the code and explains when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const end = vi.fn(async () => true)
    renderWaiting(end)

    await userEvent.click(screen.getByRole('button', { name: 'Back to roles' }))
    expect(end).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Your code cannot be closed until your connection returns.')
    expect(screen.getByTestId('pair-code')).toBeInTheDocument()
  })
})

describe('SessionView when the partner is disconnected', () => {
  it('lets the connected player end the session without waiting for them', async () => {
    const end = vi.fn(async () => true)
    render(
      <SessionView
        scenario={sampleDoorstepV2}
        snapshot={snapshot}
        connection="live"
        pending={null}
        notice={null}
        lastError="partner_stale"
        actions={actions(end)}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Your partner is disconnected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.queryByText('Waiting for your partner to reconnect.')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'End session' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Your partner is disconnected. This closes the scenario for both of you.')
    expect(dialog).not.toHaveTextContent('Waiting for your partner to reconnect.')

    await userEvent.click(within(dialog).getByRole('button', { name: 'End session' }))
    expect(end).toHaveBeenCalledOnce()
  })
})
