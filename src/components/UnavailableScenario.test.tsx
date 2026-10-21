import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { UnavailableScenario } from './UnavailableScenario'

describe('UnavailableScenario', () => {
  beforeEach(() => {
    render(
      <MemoryRouter>
        <UnavailableScenario />
      </MemoryRouter>,
    )
  })

  it('explains the bad link with one heading and focuses it', () => {
    const heading = screen.getByRole('heading', { level: 1, name: 'We couldn’t find this scenario.' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(heading).toHaveFocus()
    expect(
      screen.getByText(
        'The link may be incomplete, or the scenario may have moved. You can still practise with Lesson 1.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Ask your group leader for the latest link.')).toBeInTheDocument()
  })

  it('offers Lesson 1 as a real link and nothing that starts a practice', () => {
    const scenario = screen.getByRole('region', { name: 'Available scenario' })
    expect(scenario).toHaveTextContent('Lesson 1')
    expect(scenario).toHaveTextContent('Introduction & First Vision')
    expect(screen.getByRole('link', { name: 'Go to Lesson 1' })).toHaveAttribute('href', '/s/lesson-one-first-vision')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('keeps the illustration decorative', () => {
    expect(screen.queryByRole('img')).toBeNull()
  })
})
