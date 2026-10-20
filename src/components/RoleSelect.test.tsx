import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sampleDoorstep } from '../scenarios/fixtures'
import { RoleSelect } from './RoleSelect'
import { Welcome } from './Welcome'

describe('Welcome', () => {
  it('says who the practice is for and offers to start or join one', async () => {
    const onCreate = vi.fn()
    const onJoin = vi.fn()
    render(<Welcome notice="Your partner ended the practice." onCreate={onCreate} onJoin={onJoin} />)
    expect(screen.getByText('Conversation practice for Christians')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Practice talking with Mormon missionaries.' })).toBeInTheDocument()
    expect(screen.getByText(/the other plays a Latter-day Saint \(Mormon\)/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /open green door/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your partner ended the practice.')

    await userEvent.click(screen.getByRole('button', { name: 'Start a practice' }))
    expect(onCreate).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'Join your partner' }))
    expect(onJoin).toHaveBeenCalledOnce()
  })
})

describe('RoleSelect', () => {
  it('starts on the missionary and creates with the chosen role', async () => {
    const onCreate = vi.fn()
    render(<RoleSelect scenario={sampleDoorstep} busy={false} error={null} onCreate={onCreate} onBack={() => {}} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Which role will you practise?' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Mormon$/ })).toBeChecked()
    expect(screen.getByText('THIS WEEK’S SCENARIO')).toBeInTheDocument()
    expect(screen.getByText(sampleDoorstep.title)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Get a pairing code' }))
    expect(onCreate).toHaveBeenCalledWith('missionary')
  })

  it('lets the creator practice as the Christian, or go back', async () => {
    const onCreate = vi.fn()
    const onBack = vi.fn()
    render(<RoleSelect scenario={sampleDoorstep} busy={false} error={null} onCreate={onCreate} onBack={onBack} />)
    await userEvent.click(screen.getByRole('radio', { name: /Christian$/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Get a pairing code' }))
    expect(onCreate).toHaveBeenCalledWith('christian')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('keeps the previous choice and disables the form while creating', () => {
    render(
      <RoleSelect scenario={sampleDoorstep} initialRole="christian" busy error={null} onCreate={() => {}} onBack={() => {}} />,
    )
    expect(screen.getByRole('radio', { name: /Christian$/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Christian$/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  })
})
