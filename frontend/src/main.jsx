import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { publishBuildInfo } from './lib/build-info.js'
import { setCockpitCacheTelemetryHook } from './lib/cockpit-cache.js'
import { initBrowserRum } from './lib/observability/rum.js'
import { registerStaticAssetServiceWorker } from './lib/service-worker-registration.js'
import { isOpsDashboardHost } from './features/ops/host.js'

publishBuildInfo()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

function runAfterBoot(callback, timeout = 1500) {
  if (typeof window === 'undefined') {
    return
  }
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout })
    return
  }
  window.setTimeout(callback, Math.min(timeout, 1000))
}

function preloadLikelyPostLoginShell() {
  const pathname = window.location?.pathname || '/'
  const isPublicAuthRoute = pathname === '/login' || pathname.startsWith('/reset-password')
  if (isPublicAuthRoute) {
    void import('./app/AuthenticatedApp.jsx')
  }
}

setCockpitCacheTelemetryHook((event) => {
  window.dispatchEvent(new CustomEvent('hms:cockpit-cache-storage', { detail: event }))
})

runAfterBoot(() => {
  if (!isOpsDashboardHost()) {
    initBrowserRum()
  }
  void registerStaticAssetServiceWorker()
  preloadLikelyPostLoginShell()
})
