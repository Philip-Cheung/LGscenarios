import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JoinForm } from './JoinForm'

function setup(props: Partial<Parameters<typeof JoinForm>[0]> = {}) {
  const onJoin = vi.fn()
  render(<JoinForm busy={false} error={null} onJoin={onJoin} onBack={vi.fn()} {...props} />)
  return { onJoin, input: screen.getByLabelText('Pairing code') }
}

describe('JoinForm', () => {
  it('normalizes a well-formed code before submitting', async () => {
    const { onJoin, input } = setup()
    await userEvent.type(input, '482 716{Enter}')
    expect(onJoin).toHaveBeenCalledWith('482716')
  })

  it('ignores letters, so the field only ever holds digits', async () => {
    const { input } = setup()
    await userEvent.type(input, '48a2-7b16')
    expect(input).toHaveValue('482-716')
  })

  it('explains malformed codes without calling the server', async () => {
    const { onJoin, input } = setup()
    await userEvent.type(input, '482{Enter}')
    expect(onJoin).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter all six digits')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('returns focus to the field when Join is pressed with a bad code', async () => {
    const { input } = setup()
    await userEvent.type(input, '482')
    await userEvent.click(screen.getByRole('button', { name: 'Join practice' }))
    expect(input).toHaveFocus()
  })

  it('keeps the previous value and shows server errors', () => {
    const { input } = setup({ initialValue: '482 761', error: 'That code doesn’t match an open practice.' })
    expect(input).toHaveValue('482 761')
    expect(screen.getByRole('alert')).toHaveTextContent('doesn’t match')
  })

  it('opens the numeric keypad', () => {
    const { input } = setup()
    expect(input).toHaveAttribute('inputmode', 'numeric')
  })
})
