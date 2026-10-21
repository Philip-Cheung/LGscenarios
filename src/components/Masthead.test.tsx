import { fireEvent, render, screen } from '@testing-library/react'
import { Masthead } from './Masthead'

describe('Masthead', () => {
  it('shows the wordmark and scenario title as plain identity, with no heading or link', () => {
    render(<Masthead subtitle="Introduction & First Vision" />)
    const header = screen.getByRole('banner')
    expect(header).toHaveTextContent('Doorstep practice')
    expect(header).toHaveTextContent('Introduction & First Vision')
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('omits the title when no scenario is known', () => {
    render(<Masthead />)
    expect(screen.getByRole('banner').textContent).toBe('Doorstep practice')
  })

  it('puts the control in the right-hand slot', () => {
    const onClick = vi.fn()
    render(<Masthead subtitle="Hard mode" action={{ label: 'Leave', onClick }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
