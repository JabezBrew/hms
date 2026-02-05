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
import { featureRoutes } from './routes/featureRoutes'
import { renderRoutes } from './routes/renderRoutes'

const UnauthorizedPage = lazy(() => import('@/pages/UnauthorizedPage'))
const Toaster = lazy(() =>
  import('@/components/ui/sonner').then((module) => ({ default: module.Toaster }))
)

export default function AuthenticatedApp() {
  return (
    <ErrorBoundary>
      <ReadOnlyModeProvider>
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
            {renderRoutes(featureRoutes)}
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
        <CriticalAlertsMonitor />
        <OfflineIndicator />
        <SessionTimeoutWarning />
        <Suspense fallback={null}>
          <Toaster />
        </Suspense>
      </ReadOnlyModeProvider>
    </ErrorBoundary>
  )
}
