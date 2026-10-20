import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JoinForm } from './JoinForm'

function setup(props: Partial<Parameters<typeof JoinForm>[0]> = {}) {
  const onJoin = vi.fn()
  render(<JoinForm busy={false} error={null} onJoin={onJoin} onBack={vi.fn()} {...props} />)
  return { onJoin, input: screen.getByLabelText('Pair code') }
}

describe('JoinForm', () => {
  it('normalizes a well-formed code before submitting', async () => {
    const { onJoin, input } = setup()
    await userEvent.type(input, 'k7m-pq3{Enter}')
    expect(onJoin).toHaveBeenCalledWith('K7MPQ3')
  })

  it('explains malformed codes without calling the server', async () => {
    const { onJoin, input } = setup()
    await userEvent.type(input, 'abc{Enter}')
    expect(onJoin).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the 6-character code')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('returns focus to the field when Join is pressed with a bad code', async () => {
    const { input } = setup()
    await userEvent.type(input, 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(input).toHaveFocus()
  })

  it('keeps the previous value and shows server errors', () => {
    const { input } = setup({ initialValue: 'K7M-PQ3', error: 'That code is not valid or is no longer available.' })
    expect(input).toHaveValue('K7M-PQ3')
    expect(screen.getByRole('alert')).toHaveTextContent('no longer available')
  })
})
