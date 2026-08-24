import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../lib/fonts/fonts.css'
import '../lib/DataTable.css'
import './valorant.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
