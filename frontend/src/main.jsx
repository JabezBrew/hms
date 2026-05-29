import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { publishBuildInfo } from './lib/build-info.js'
import { isOpsDashboardHost } from './features/ops/host.js'

const RUM_TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

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

function runAfterStartup(callback, delay = 3000) {
  if (typeof window === 'undefined') {
    return
  }
  window.setTimeout(callback, delay)
}

function preloadLikelyPostLoginShell() {
  const pathname = window.location?.pathname || '/'
  const isPublicAuthRoute = pathname === '/login' || pathname.startsWith('/reset-password')
  if (isPublicAuthRoute) {
    void import('./app/AuthenticatedApp.jsx')
  }
}

function isBrowserRumEnabled() {
  const runtimeConfig = window.__HMS_RUNTIME_CONFIG__
  if (runtimeConfig && typeof runtimeConfig === 'object' && 'rumEnabled' in runtimeConfig) {
    if (runtimeConfig.rumEnabled === true) {
      return true
    }
    if (runtimeConfig.rumEnabled === false || runtimeConfig.rumEnabled == null) {
      return false
    }
    return RUM_TRUE_VALUES.has(String(runtimeConfig.rumEnabled).trim().toLowerCase())
  }
  return RUM_TRUE_VALUES.has(String(import.meta.env?.VITE_RUM_ENABLED || '').trim().toLowerCase())
}

async function startPostBootServices() {
  const { setCockpitCacheTelemetryHook } = await import('./lib/cockpit-cache.js')
  setCockpitCacheTelemetryHook((event) => {
    window.dispatchEvent(new CustomEvent('hms:cockpit-cache-storage', { detail: event }))
  })

  if (!isOpsDashboardHost() && isBrowserRumEnabled()) {
    const { initBrowserRum } = await import('./lib/observability/rum.js')
    initBrowserRum()
  }
  const { registerStaticAssetServiceWorker } = await import('./lib/service-worker-registration.js')
  void registerStaticAssetServiceWorker()
}

runAfterStartup(() => {
  void startPostBootServices()
})

runAfterBoot(() => {
  preloadLikelyPostLoginShell()
})
