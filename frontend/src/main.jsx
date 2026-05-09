import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { publishBuildInfo } from './lib/build-info.js'
import { initBrowserRum } from './lib/observability/rum.js'

publishBuildInfo()
initBrowserRum()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
