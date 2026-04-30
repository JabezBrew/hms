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

  it('fails closed for cross-feature routes missing supplemental feature metadata', () => {
    expect(() => validateRoutes([
      {
        path: '/billing/discharges',
        component: () => null,
        roles: null,
        features: ['billing'],
        layout: ROUTE_LAYOUTS.APP,
      },
    ])).toThrow(/must declare feature discharge_workflows/)
  })

  it('fails closed for non-prefix tier-controlled routes without feature metadata', () => {
    expect(() => validateRoutes([
      {
        path: '/dashboards/nurse',
        component: () => null,
        roles: null,
        layout: ROUTE_LAYOUTS.BARE,
      },
    ])).toThrow(/must declare feature nursing_workflows/)
  })

  it('declares expected features for cross-feature and subfeature routes', () => {
    const routesByPath = new Map(featureRoutes.map((route) => [route.path, route]))

    expect(routesByPath.get('/billing/admissions')?.features).toEqual(
      expect.arrayContaining(['billing', 'inpatient_admissions'])
    )
    expect(routesByPath.get('/billing/discharges')?.features).toEqual(
      expect.arrayContaining(['billing', 'discharge_workflows'])
    )
    expect(routesByPath.get('/billing/claims')?.features).toEqual(
      expect.arrayContaining(['billing', 'insurance_claims'])
    )
    expect(routesByPath.get('/nursing/admissions')?.features).toEqual(
      expect.arrayContaining(['nursing_workflows', 'inpatient_admissions'])
    )
    expect(routesByPath.get('/nursing/discharges')?.features).toEqual(
      expect.arrayContaining(['nursing_workflows', 'discharge_workflows'])
    )
    expect(routesByPath.get('/admin/audit-logs')?.features).toEqual(
      expect.arrayContaining(['audit'])
    )
    expect(routesByPath.get('/charts/templates')?.features).toEqual(
      expect.arrayContaining(['clinical_notes'])
    )
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
