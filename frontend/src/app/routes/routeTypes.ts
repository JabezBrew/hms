import type { AppRoute, RouteLayout } from '@/types/routes'

export const ROUTE_LAYOUTS = Object.freeze({
  APP: 'app',
  BARE: 'bare',
})

function isValidLayout(layout: unknown): layout is RouteLayout {
  return typeof layout === 'string' && Object.values(ROUTE_LAYOUTS).includes(layout as RouteLayout)
}

export function validateRoutes(routes: AppRoute[], { source = 'routes' }: { source?: string } = {}) {
  if (!Array.isArray(routes)) {
    throw new Error(`[${source}] Expected routes array`)
  }

  routes.forEach((route) => {
    if (!route?.path) {
      throw new Error(`[${source}] Route is missing path`)
    }
    if (!route?.component) {
      throw new Error(`[${source}] Route ${route.path} is missing component`)
    }
    if (!route?.layout || !isValidLayout(route.layout)) {
      throw new Error(`[${source}] Route ${route.path} has invalid layout`)
    }
    if (route.roles === undefined) {
      throw new Error(`[${source}] Route ${route.path} must declare roles (use null for all)`)
    }
  })
}
