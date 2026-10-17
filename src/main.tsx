import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/space-grotesk/latin-500.css'
import '@fontsource/space-grotesk/latin-700.css'
import '@fontsource/dm-mono/latin-500.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/screens.css'
import { App } from './App'

// con ?herramientas se carga el generador de retratos para las pruebas (tests/retratos.mjs)
if (new URLSearchParams(window.location.search).has('herramientas')) void import('./avatar/thumbnail')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
