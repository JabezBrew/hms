import type { ReactNode } from 'react'
import { Route } from 'react-router-dom'
import { RoleBasedRoute } from '@/components/auth/RoleBasedRoute'
import { Layout } from '@/components/layout/layout'
import { PageMeta } from '@/shared/hooks/usePageMeta'
import type { AppRoute, RouteLayout } from '@/types/routes'
import { ROUTE_LAYOUTS } from './routeTypes'

function wrapWithLayout(layout: RouteLayout, content: ReactNode): ReactNode {
  if (layout === ROUTE_LAYOUTS.APP) {
    return <Layout>{content}</Layout>
  }
  return content
}

export function renderRoutes(routes: AppRoute[]) {
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

    const withLayout = wrapWithLayout(route.layout, withMeta)

    return (
      <Route
        key={route.path}
        path={route.path}
        element={
          <RoleBasedRoute allowedRoles={route.roles ? [...route.roles] : []}>
            {withLayout}
          </RoleBasedRoute>
        }
      />
    )
  })
}
