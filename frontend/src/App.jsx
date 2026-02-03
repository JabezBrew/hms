import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './components/theme-provider'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { ViewModeProvider } from './contexts/ViewModeContext'
import { WorkflowProvider } from './contexts/WorkflowContext'
import { ReadOnlyModeProvider } from './contexts/ReadOnlyModeContext'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { queryClient } from './lib/react-query'
import { Layout } from './components/layout/layout'
import { Toaster } from './components/ui/sonner'
import { BreadcrumbProvider } from './components/layout/PageBreadcrumb'
import { Skeleton } from './components/ui/skeleton'
import { PageLoader } from './shared/components/page/PageState'
import { LoginForm } from './components/auth/login-form'
import { ResetPasswordForm } from './components/auth/reset-password-form'
import { ResetPasswordConfirmForm } from './components/auth/reset-password-confirm-form'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OfflineIndicator } from './components/OfflineIndicator'
import { featureRoutes } from './app/routes/featureRoutes'
import { renderRoutes } from './app/routes/renderRoutes'
import { SessionTimeoutWarning } from './components/SessionTimeoutWarning'
import { CriticalAlertsMonitor } from './components/dashboard'
import { ReadOnlyBanner } from './components/readonly'

// Lazy load page components for code splitting
const UnauthorizedPage = lazy(() => import('./pages/UnauthorizedPage'))

// Main app content with routes
function AppContent() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        {/* Skeleton for header */}
        <header className="border-b">
          <div className="flex h-16 items-center px-4">
            <Skeleton className="h-8 w-40" />
            <div className="ml-auto flex items-center space-x-4">
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        </header>

        {/* Skeleton for main content */}
        <div className="flex flex-1">
          {/* Skeleton for sidebar */}
          <aside className="hidden w-64 border-r bg-muted/40 lg:block">
            <div className="flex flex-col gap-2 p-4">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-36" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-38" />
            </div>
          </aside>

          {/* Skeleton for main content area */}
          <main className="flex-1 p-8">
            <div className="space-y-6">
              <Skeleton className="h-10 w-1/4" />
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-40 w-full rounded-lg" />
              </div>
            </div>
          </main>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={
          <div className="flex min-h-screen items-center justify-center">
            <LoginForm />
          </div>
        } />
        <Route path="/reset-password" element={
          <div className="flex min-h-screen items-center justify-center">
            <ResetPasswordForm />
          </div>
        } />
        <Route path="/reset-password/confirm" element={
          <div className="flex min-h-screen items-center justify-center">
            <ResetPasswordConfirmForm />
          </div>
        } />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    )
  }

  return (
    <ErrorBoundary>
      <ReadOnlyModeProvider>
        <ReadOnlyBanner />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Unauthorized page */}
            <Route path="/unauthorized" element={
              <Layout>
                <UnauthorizedPage />
              </Layout>
            } />

            {renderRoutes(featureRoutes)}

            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
        {/* Mount critical alerts monitor only for authenticated users */}
        <CriticalAlertsMonitor />
      </ReadOnlyModeProvider>
    </ErrorBoundary>
  )
}


function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <HelmetProvider>
          <AuthProvider>
            <BrowserRouter>
              <BreadcrumbProvider>
                <ViewModeProvider>
                  <WorkflowProvider>
                    <AppContent />
                    <Toaster />
                    <OfflineIndicator />
                    <SessionTimeoutWarning />
                  </WorkflowProvider>
                </ViewModeProvider>
              </BreadcrumbProvider>
            </BrowserRouter>
          </AuthProvider>
        </HelmetProvider>
      </ThemeProvider>
      {/* Add React Query Devtools - only in development */}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}

export default App
