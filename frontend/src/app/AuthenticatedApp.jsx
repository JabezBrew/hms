import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { OfflineIndicator } from '@/components/OfflineIndicator'
import { SessionTimeoutWarning } from '@/components/SessionTimeoutWarning'
import CriticalAlertsMonitor from '@/components/dashboard/CriticalAlertsMonitor'
import { Layout } from '@/components/layout/layout'
import { ReadOnlyBanner } from '@/components/readonly'
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext'
import { PageLoader } from '@/shared/components/page/PageState'
import { OmniSearchProvider } from '@/shared/components/omni-search/OmniSearchProvider'
import RouteChunkWarmup from './RouteChunkWarmup'
import { featureRoutes } from './routes/featureRoutes'
import { renderRoutes } from './routes/renderRoutes'

const UnauthorizedPage = lazy(() => import('@/pages/UnauthorizedPage'))
const FeatureUnavailablePage = lazy(() => import('@/pages/FeatureUnavailablePage'))
const Toaster = lazy(() =>
  import('@/components/ui/sonner').then((module) => ({ default: module.Toaster }))
)
const OnboardingRuntime = lazy(() => import('@/features/onboarding/components/OnboardingRuntime'))
const LoginInboxToaster = lazy(() => import('@/features/inbox/components/LoginInboxToaster'))

export default function AuthenticatedApp() {
  return (
    <ErrorBoundary>
      <ReadOnlyModeProvider>
        <OmniSearchProvider>
          <ReadOnlyBanner />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route
                path="/unauthorized"
                element={
                  <Layout>
                    <UnauthorizedPage />
                  </Layout>
                }
              />
              <Route
                path="/feature-unavailable"
                element={
                  <Layout>
                    <FeatureUnavailablePage />
                  </Layout>
                }
              />
              {/* react-doctor-disable-next-line react-doctor/no-render-in-render -- Route element generation is a pure route-table projection, not a nested component definition. */}
              {/* oxlint-disable-next-line react-doctor/no-render-in-render -- Route metadata is rendered by a pure router adapter, not an inline component with state or hooks. */}
              {/* oxlint-disable-next-line react-doctor/no-render-in-render -- Route metadata is rendered by a pure router adapter, not an inline component with state or hooks. */}
              {renderRoutes(featureRoutes)}
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
          <Suspense fallback={null}>
            <OnboardingRuntime />
          </Suspense>
          <CriticalAlertsMonitor />
          <RouteChunkWarmup />
          <OfflineIndicator />
          <SessionTimeoutWarning />
          <Suspense fallback={null}>
            <Toaster />
          </Suspense>
          <Suspense fallback={null}>
            <LoginInboxToaster />
          </Suspense>
        </OmniSearchProvider>
      </ReadOnlyModeProvider>
    </ErrorBoundary>
  )
}
