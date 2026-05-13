import { Navigate, Route } from 'react-router-dom'
import { FeatureBasedRoute } from '@/components/auth/FeatureBasedRoute'
import { RoleBasedRoute } from '@/components/auth/RoleBasedRoute'
import { Layout } from '@/components/layout/layout'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { PageMeta } from '@/shared/hooks/usePageMeta'
import { ROUTE_LAYOUTS } from './routeTypes'

function wrapWithLayout(route, content) {
  const { layout, sidebar } = route

  if (layout === ROUTE_LAYOUTS.APP) {
    return <Layout sidebar={sidebar}>{content}</Layout>
  }
  return content
}

export function renderRoutes(routes) {
  return routes.map((route) => {
    const Component = route.component
    const withMeta = (
      <>
        {(route.title || route.breadcrumbs) && (
          <PageMeta title={route.title} breadcrumbs={route.breadcrumbs} />
        )}
        <Component {...(route.props || {})} />
      </>
    )

    const routeContent = route.rustV2Supported === false && isRustV2ApiMode()
      ? <Navigate to="/feature-unavailable" replace />
      : withMeta
    const withLayout = wrapWithLayout(route, routeContent)

    return (
      <Route
        key={route.path}
        path={route.path}
        element={
          <FeatureBasedRoute features={route.features}>
            <RoleBasedRoute allowedRoles={route.roles} allowedCapabilities={route.capabilities}>
              {withLayout}
            </RoleBasedRoute>
          </FeatureBasedRoute>
        }
      />
    )
  })
}
