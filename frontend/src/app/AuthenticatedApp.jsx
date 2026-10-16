import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Layout } from '@/components/layout/layout'
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary'
import { PageLoader } from '@/shared/components/page/PageState'
import { OmniSearchProvider } from '@/shared/components/omni-search/OmniSearchProvider'
import AppStartupServices from './AppStartupServices'
import { featureRoutes } from './routes/featureRoutes'
import { renderRoutes } from './routes/renderRoutes'

const UnauthorizedPage = lazy(() => import('@/pages/UnauthorizedPage'))
const FeatureUnavailablePage = lazy(() => import('@/pages/FeatureUnavailablePage'))

export default function AuthenticatedApp() {
  return (
    <ErrorBoundary>
      <NetworkAccessBoundary>
        <OmniSearchProvider>
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
          <AppStartupServices />
        </OmniSearchProvider>
      </NetworkAccessBoundary>
    </ErrorBoundary>
  )
}
