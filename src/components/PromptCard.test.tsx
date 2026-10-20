import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { sampleDoorstepV1 } from '../scenarios/sample-doorstep.v1'
import { PromptCard, type PromptCardProps } from './PromptCard'

function setup(overrides: Partial<PromptCardProps> = {}) {
  const props: PromptCardProps = {
    scenario: sampleDoorstepV1,
    role: 'christian',
    promptIndex: 1,
    statusText: '',
    canAct: true,
    pending: null,
    headingRef: { current: null },
    onBack: vi.fn(),
    onNext: vi.fn(),
    onFinish: vi.fn(),
    ...overrides,
  }
  const view = render(<PromptCard key={`${props.role}-${props.promptIndex}`} {...props} />)
  return { props, view }
}

const prompt = sampleDoorstepV1.prompts[1]

describe('PromptCard', () => {
  it('hides the suggested answer for the Christian until revealed', async () => {
    setup()
    const toggle = screen.getByRole('button', { name: 'Show answer' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(prompt.suggestedAnswer)).not.toBeVisible()

    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide answer' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(prompt.suggestedAnswer)).toBeVisible()
  })

  it('hides the answer again when the prompt changes', async () => {
    const { props, view } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    view.rerender(<PromptCard key={`${props.role}-2`} {...props} promptIndex={2} />)
    expect(screen.getByRole('button', { name: 'Show answer' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(sampleDoorstepV1.prompts[2].suggestedAnswer)).not.toBeVisible()
  })

  it('never shows answers or navigation controls to the missionary', () => {
    setup({ role: 'missionary' })
    expect(screen.queryByRole('button', { name: /answer/i })).toBeNull()
    expect(screen.queryByText(prompt.suggestedAnswer)).toBeNull()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('gives the Christian no navigation controls', () => {
    setup()
    expect(screen.queryByRole('button', { name: /next|back|finish/i })).toBeNull()
    expect(screen.getByText('Your partner controls next and back.')).toBeInTheDocument()
  })

  it('disables Back on the first prompt and offers Finish on the last', async () => {
    const first = setup({ role: 'missionary', promptIndex: 0 })
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    first.view.unmount()

    const onFinish = vi.fn()
    setup({ role: 'missionary', promptIndex: 2, onFinish })
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('blocks navigation while the missionary cannot act', () => {
    setup({ role: 'missionary', canAct: false })
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  it('shows the position and prompt as the focusable heading', () => {
    setup()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: prompt.text })).toHaveAttribute('tabindex', '-1')
  })
})
