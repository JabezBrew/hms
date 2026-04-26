export const ROUTE_LAYOUTS = Object.freeze({
  APP: 'app',
  BARE: 'bare',
})

export function validateRoutes(routes, { source = 'routes' } = {}) {
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
    if (!route?.layout || !Object.values(ROUTE_LAYOUTS).includes(route.layout)) {
      throw new Error(`[${source}] Route ${route.path} has invalid layout`)
    }
    if (route.roles === undefined) {
      throw new Error(`[${source}] Route ${route.path} must declare roles (use null for all)`)
    }
    if (route.features !== undefined && !Array.isArray(route.features)) {
      throw new Error(`[${source}] Route ${route.path} features must be an array`)
    }
  })
}
