import { lazy, Suspense } from 'react'
import { BrowserRouter, useLocation } from 'react-router-dom'
import { ThemeProvider } from './components/theme-provider'
import { AuthProvider, useAuth } from './lib/auth.jsx'
import { ViewModeProvider } from './contexts/ViewModeContext'
import { WorkflowProvider } from './contexts/WorkflowContext'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import RuntimeErrorGuard from './app/RuntimeErrorGuard'
import PublicAuthLoader from './app/PublicAuthLoader'
import { queryClient } from './lib/react-query'
import { BreadcrumbProvider } from './components/layout/PageBreadcrumb'
import { Skeleton } from './components/ui/skeleton'
import { PageLoader } from './shared/components/page/PageState'
import { isStandaloneOpsDashboardHost } from './features/ops/host'

const AuthenticatedApp = lazy(() => import('./app/AuthenticatedApp'))
const OpsDashboardApp = lazy(() => import('./app/OpsDashboardApp'))
const PublicAuthApp = lazy(() => import('./app/PublicAuthApp'))
const PasswordChangeRequiredApp = lazy(() => import('./app/PasswordChangeRequiredApp'))

// Main app content with routes
function AppContent() {
  const { isAuthenticated, loading, passwordChangeRequired } = useAuth()
  const { pathname } = useLocation()
  const isOpsHost = isStandaloneOpsDashboardHost()
  const isPublicAuthRoute = pathname === '/login' || pathname.startsWith('/reset-password')
  const appState = isOpsHost
    ? 'ops'
    : loading
      ? 'booting'
      : !isAuthenticated
        ? 'public'
        : passwordChangeRequired
          ? 'password-change-required'
          : 'authenticated'

  let content

  if (isOpsHost) {
    content = (
      <Suspense fallback={<PageLoader />}>
        <OpsDashboardApp />
      </Suspense>
    )
  } else if (loading) {
    content = isPublicAuthRoute ? (
      <PublicAuthLoader />
    ) : (
      <div className="flex min-h-screen flex-col">
        {/* Skeleton for header */}
        <header className="border-b">
          <div className="flex h-16 items-center px-4">
            <Skeleton className="h-8 w-40" />
            <div className="ml-auto flex items-center gap-x-4">
              <Skeleton className="size-8 rounded-full" />
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
  } else if (!isAuthenticated) {
    content = (
      <Suspense fallback={<PublicAuthLoader />}>
        <PublicAuthApp />
      </Suspense>
    )
  } else if (passwordChangeRequired) {
    content = (
      <Suspense fallback={<PageLoader />}>
        <PasswordChangeRequiredApp />
      </Suspense>
    )
  } else {
    content = (
      <Suspense fallback={<PageLoader />}>
        <AuthenticatedApp />
      </Suspense>
    )
  }

  return (
    <RuntimeErrorGuard appState={appState}>
      {content}
    </RuntimeErrorGuard>
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
