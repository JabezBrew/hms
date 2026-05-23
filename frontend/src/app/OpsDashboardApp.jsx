import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PageLoader } from '@/shared/components/page/PageState'

const OpsDashboardPage = lazy(() => import('@/features/ops/pages/OpsDashboardPage'))

export default function OpsDashboardApp() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Navigate to="/system/ops" replace />} />
          <Route path="/system/ops" element={<OpsDashboardPage />} />
          <Route path="/system/ops/*" element={<OpsDashboardPage />} />
          <Route path="*" element={<Navigate to="/system/ops" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
