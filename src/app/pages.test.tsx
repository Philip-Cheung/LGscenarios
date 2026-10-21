import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ScenarioPage } from './pages'

vi.mock('../lib/env', () => ({
  configResult: { ok: false, problems: ['VITE_SUPABASE_URL is missing'] },
}))

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/s/:slug" element={<ScenarioPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ScenarioPage', () => {
  it('explains missing configuration instead of starting a session', () => {
    renderAt('/s/sample-doorstep')
    expect(screen.getByRole('heading', { name: 'Practice is not set up yet' })).toBeInTheDocument()
    expect(screen.getByText('VITE_SUPABASE_URL is missing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mormon missionary' })).toBeNull()
  })

  it('shows the recovery page for links that cannot be a scenario id', () => {
    renderAt('/s/Not_A_Scenario!')
    expect(screen.getByRole('heading', { level: 1, name: 'We couldn’t find this scenario.' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Lesson 1' })).toHaveAttribute('href', '/s/lesson-one-first-vision')
  })
})
