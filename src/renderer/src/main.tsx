// Global styles first: component stylesheets are loaded by their components
// and must be able to override these primitives on equal specificity.
import './styles.css'
import './controls.css'
import './feedback.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Renderer mount point #root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
