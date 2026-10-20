// Stylesheet order matters: tokens first, then app globals.
import './styles/tokens.css'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applySavedMotionPreference } from './lib/motion'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

applySavedMotionPreference()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
