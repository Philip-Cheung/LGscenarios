import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { NotFoundPage, RootPage, ScenarioPage } from './pages'

// Development-only screen gallery. import.meta.env.DEV is false in production
// builds, so this route and module are removed from the bundle.
const DevPreview = import.meta.env.DEV ? lazy(() => import('./DevPreview')) : null

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RootPage />} />
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
