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

  it('shows a friendly not-found view for links that cannot be a scenario id', () => {
    renderAt('/s/Not_A_Scenario!')
    expect(screen.getByRole('heading', { name: 'We could not find that scenario' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})
