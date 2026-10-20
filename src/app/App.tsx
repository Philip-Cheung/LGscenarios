import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { CURRENT_SCENARIO_SLUG } from '../scenarios'
import { NotFoundPage, ScenarioPage } from './pages'

// Development-only screen gallery. import.meta.env.DEV is false in production
// builds, so this route and module are removed from the bundle.
const DevPreview = import.meta.env.DEV ? lazy(() => import('./DevPreview')) : null

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={`/s/${CURRENT_SCENARIO_SLUG}`} replace />} />
        <Route path="/s/:slug" element={<ScenarioPage />} />
        {DevPreview ? (
          <Route
            path="/dev/preview"
            element={
              <Suspense fallback={null}>
                <DevPreview />
              </Suspense>
            }
          />
        ) : null}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
