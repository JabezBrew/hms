import { describe, it, expect } from 'vitest'
import { featureRoutes } from './featureRoutes'
import { ROUTE_LAYOUTS, SIDEBARS, validateRoutes } from './routeTypes'


describe('featureRoutes', () => {
  it('declares roles and layout for each route', () => {
    featureRoutes.forEach((route) => {
      expect(route.path).toBeTruthy()
      expect(route.component).toBeTruthy()
      expect(route.layout).toBeTruthy()
      expect(route.roles).not.toBeUndefined()
    })
  })

  it('passes strict route metadata validation', () => {
    expect(() => validateRoutes(featureRoutes, { source: 'featureRoutes' })).not.toThrow()
  })

  it('fails closed for tier-controlled routes without feature metadata', () => {
    expect(() => validateRoutes([
      {
        path: '/laboratory/orders',
        component: () => null,
        roles: null,
        layout: ROUTE_LAYOUTS.APP,
      },
    ])).toThrow(/must declare feature laboratory/)
  })

  it('validates capabilities metadata when present', () => {
    expect(() => validateRoutes([
      {
        path: '/admin/example',
        component: () => null,
        roles: [],
        capabilities: 'admin.roster.manage',
        layout: ROUTE_LAYOUTS.APP,
      },
    ])).toThrow(/capabilities must be an array/)
  })

  it('accepts known sidebar metadata', () => {
    expect(() => validateRoutes([
      {
        path: '/patients',
        component: () => null,
        roles: null,
        layout: ROUTE_LAYOUTS.APP,
        sidebar: SIDEBARS.PATIENTS,
      },
    ])).not.toThrow()
  })

  it('fails closed for unknown sidebar metadata', () => {
    expect(() => validateRoutes([
      {
        path: '/patients',
        component: () => null,
        roles: null,
        layout: ROUTE_LAYOUTS.APP,
        sidebar: 'unknown-sidebar',
      },
    ])).toThrow(/invalid sidebar/)
  })

  it('allows app routes to omit sidebar metadata for global fallback', () => {
    expect(() => validateRoutes([
      {
        path: '/dashboard/provider',
        component: () => null,
        roles: null,
        layout: ROUTE_LAYOUTS.APP,
      },
    ])).not.toThrow()
  })
})
