import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

function Harness() {
  const [open, setOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  return (
    <div id="root">
      <button type="button" onClick={() => setOpen(true)}>
        Exit
      </button>
      <p>{confirmed ? 'Ended' : 'Playing'}</p>
      {open ? (
        <ConfirmDialog
          title="End this session?"
          description="This ends the scenario for both players. You can start a new pair afterward."
          confirmLabel="End session"
          destructive
          onConfirm={() => {
            setConfirmed(true)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </div>
  )
}

describe('ConfirmDialog', () => {
  it('focuses the safe action, cancels on Escape, and restores focus', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }))
    const dialog = screen.getByRole('alertdialog', { name: 'End this session?' })
    expect(dialog).toHaveAccessibleDescription(/both players/)
    expect(screen.getByRole('button', { name: 'Keep playing' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exit' })).toHaveFocus()
    expect(screen.getByText('Playing')).toBeInTheDocument()
  })

  it('confirms from the keyboard without leaving the dialog until the action runs', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }))
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'End session' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByText('Ended')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})