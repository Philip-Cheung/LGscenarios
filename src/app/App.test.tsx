import { render, screen } from '@testing-library/react'
import { CURRENT_SCENARIO_SLUG, findLatestBundledBySlug } from '../scenarios'
import { App } from './App'

vi.mock('../lib/env', () => ({
  configResult: { ok: false, problems: ['VITE_SUPABASE_URL is missing'] },
}))

describe('App routing', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('points the current scenario at a bundled version', () => {
    expect(findLatestBundledBySlug(CURRENT_SCENARIO_SLUG)).toBeDefined()
  })

  it('redirects the site root to the current scenario', async () => {
    window.history.replaceState(null, '', '/')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Practice is not set up yet' })).toBeInTheDocument()
    expect(window.location.pathname).toBe(`/s/${CURRENT_SCENARIO_SLUG}`)
  })
})
