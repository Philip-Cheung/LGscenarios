import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('renders a native button that defaults to type="button"', () => {
    render(<Button>Next</Button>)
    const button = screen.getByRole('button', { name: 'Next' })
    expect(button).toHaveAttribute('type', 'button')
  })

  it('calls onClick when enabled', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Next</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is disabled and busy while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Next
      </Button>,
    )
    const button = screen.getByRole('button', { name: /Next/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
