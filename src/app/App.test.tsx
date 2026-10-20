import { render, screen } from '@testing-library/react'
import { App } from './App'

vi.mock('../lib/env', () => ({
  configResult: { ok: false, problems: ['VITE_SUPABASE_URL is missing'] },
}))

describe('App routing', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('explains missing configuration at the site root instead of guessing a scenario', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Practice is not set up yet' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })

  it('shows the not-found page for unknown paths', async () => {
    window.history.replaceState(null, '', '/somewhere/else')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'We could not find that scenario' })).toBeInTheDocument()
  })
})
