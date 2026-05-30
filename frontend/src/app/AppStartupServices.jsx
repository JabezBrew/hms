import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

import RouteChunkWarmup from './RouteChunkWarmup'

const CriticalAlertsMonitor = lazy(() => import('@/components/dashboard/CriticalAlertsMonitor'))
const OnboardingRuntime = lazy(() => import('@/features/onboarding/components/OnboardingRuntime'))
const LoginInboxToaster = lazy(() => import('@/features/inbox/components/LoginInboxToaster'))
const OfflineIndicator = lazy(() =>
  import('@/components/OfflineIndicator').then((module) => ({ default: module.OfflineIndicator }))
)
const SessionTimeoutWarning = lazy(() =>
  import('@/components/SessionTimeoutWarning').then((module) => ({
    default: module.SessionTimeoutWarning,
  }))
)
const Toaster = lazy(() =>
  import('@/components/ui/sonner').then((module) => ({ default: module.Toaster }))
)

const ROUTE_READY_SELECTOR = '[data-perf-ready]:not([data-perf-ready="app-shell"])'
const FIRST_ROUTE_READY_FALLBACK_MS = 2500
const LATE_SERVICES_DELAY_MS = 1200

function isVisible(element) {
  return Boolean(
    element
      && (element.offsetWidth > 0 || element.offsetHeight > 0 || element.getClientRects().length > 0)
  )
}

function findReadyRouteElement() {
  if (typeof document === 'undefined') {
    return null
  }
  return Array.from(document.querySelectorAll(ROUTE_READY_SELECTOR)).find(isVisible) || null
}

function publishFirstRouteReady(pathname) {
  if (typeof window === 'undefined') {
    return
  }

  window.__hmsFirstRouteReady = true
  window.dispatchEvent(new CustomEvent('hms:first-route-ready', {
    detail: { pathname },
  }))
}

function useFirstRouteReady() {
  const { pathname } = useLocation()
  const [ready, setReady] = useState(() => Boolean(findReadyRouteElement()))

  useEffect(() => {
    if (ready) {
      publishFirstRouteReady(pathname)
      return undefined
    }

    if (typeof document === 'undefined') {
      return undefined
    }

    let cancelled = false
    let rafId = 0
    const publish = () => {
      if (cancelled) {
        return
      }
      publishFirstRouteReady(pathname)
      setReady(true)
    }
    const check = () => {
      if (findReadyRouteElement()) {
        publish()
      }
    }

    rafId = window.requestAnimationFrame(check)
    const fallbackId = window.setTimeout(publish, FIRST_ROUTE_READY_FALLBACK_MS)
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-perf-ready', 'class', 'style'],
      childList: true,
      subtree: true,
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(fallbackId)
      observer.disconnect()
    }
  }, [pathname, ready])

  return ready
}

function useDelayedFlag(enabled, delayMs) {
  const [delayed, setDelayed] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setDelayed(false)
      return undefined
    }

    const id = window.setTimeout(() => setDelayed(true), delayMs)
    return () => window.clearTimeout(id)
  }, [delayMs, enabled])

  return delayed
}

function FirstReadyServices() {
  return (
    <Suspense fallback={null}>
      <OfflineIndicator />
      <SessionTimeoutWarning />
      <Toaster />
    </Suspense>
  )
}

function LateStartupServices() {
  return (
    <>
      <RouteChunkWarmup />
      <Suspense fallback={null}>
        <CriticalAlertsMonitor />
        <OnboardingRuntime />
        <LoginInboxToaster />
      </Suspense>
    </>
  )
}

export default function AppStartupServices() {
  const firstRouteReady = useFirstRouteReady()
  const lateServicesReady = useDelayedFlag(firstRouteReady, LATE_SERVICES_DELAY_MS)

  return (
    <>
      {firstRouteReady && <FirstReadyServices />}
      {lateServicesReady && <LateStartupServices />}
    </>
  )
}
