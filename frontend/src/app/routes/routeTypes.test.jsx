import { describe, it, expect } from 'vitest'
import { featureRoutes } from './featureRoutes'
import { ROUTE_LAYOUTS, SIDEBARS, requiredFeaturesForRoute, validateRoutes } from './routeTypes'


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

  it('fails closed for ward board routes without feature metadata', () => {
    expect(() => validateRoutes([
      {
        path: '/ward-board',
        component: () => null,
        roles: null,
        layout: ROUTE_LAYOUTS.APP,
      },
    ])).toThrow(/must declare features .*ward_task_board.*patient_chronicle.*wards.*inpatient_admissions.*nursing_workflows/)
  })

  it('reports required feature metadata for controlled route prefixes', () => {
    expect(requiredFeaturesForRoute('/patients/create')).toEqual(
      expect.arrayContaining(['patient_chronicle', 'patient_registration'])
    )
    expect(requiredFeaturesForRoute('/encounters/new')).toEqual(['outpatient_encounters'])
    expect(requiredFeaturesForRoute('/billing/nhis/mappings')).toEqual(
      expect.arrayContaining(['billing', 'insurance_claims'])
    )
    expect(requiredFeaturesForRoute('/patients/:id/ward-round')).toEqual(
      expect.arrayContaining(['patient_chronicle', 'wards'])
    )
    expect(requiredFeaturesForRoute('/ward-board')).toEqual(
      expect.arrayContaining([
        'ward_task_board',
        'patient_chronicle',
        'wards',
        'inpatient_admissions',
        'nursing_workflows',
      ])
    )
    expect(requiredFeaturesForRoute('/wards/:wardId/board')).toEqual(
      expect.arrayContaining([
        'ward_task_board',
        'patient_chronicle',
        'wards',
        'inpatient_admissions',
        'nursing_workflows',
      ])
    )
  })

  it.each([
    ['/patients/new-route', 'patient_chronicle'],
    ['/encounters/new-route', 'outpatient_encounters'],
    ['/inventory/new-route', 'inventory'],
    ['/laboratory/new-route', 'laboratory'],
    ['/pharmacy/new-route', 'pharmacy'],
    ['/referrals/new-route', 'referrals'],
    ['/clinical-notes/new-route', 'clinical_notes'],
  ])('fails closed for ungated controlled route %s', (path, missingFeature) => {
    expect(() => validateRoutes([
      {
        path,
        component: () => null,
        roles: null,
        layout: ROUTE_LAYOUTS.APP,
      },
    ])).toThrow(new RegExp(`must declare feature ${missingFeature}`))
  })

  it('declares expected features for cross-feature and subfeature routes', () => {
    const routesByPath = new Map(featureRoutes.map((route) => [route.path, route]))

    expect(routesByPath.get('/patients')?.features).toEqual(
      expect.arrayContaining(['patient_chronicle'])
    )
    expect(routesByPath.get('/patients/create')?.features).toEqual(
      expect.arrayContaining(['patient_chronicle', 'patient_registration'])
    )
    expect(routesByPath.get('/patients/:id/chronicle/print')?.roles).toEqual(
      expect.arrayContaining(['admin', 'doctor', 'nurse'])
    )
    expect(routesByPath.get('/encounters/new')?.features).toEqual(
      expect.arrayContaining(['outpatient_encounters'])
    )
    expect(routesByPath.get('/appointments/new')?.features).toEqual(
      expect.arrayContaining(['appointments'])
    )
    expect(routesByPath.get('/encounters/:id/clinical-notes')?.features).toEqual(
      expect.arrayContaining(['clinical_notes', 'outpatient_encounters'])
    )
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
    if (routesByPath.has('/ward-board')) {
      expect(routesByPath.get('/ward-board')?.features).toEqual(
        expect.arrayContaining([
          'ward_task_board',
          'patient_chronicle',
          'wards',
          'inpatient_admissions',
          'nursing_workflows',
        ])
      )
      expect(routesByPath.get('/ward-board')?.features).not.toContain('discharge_workflows')
    }
    if (routesByPath.has('/wards/:wardId/board')) {
      expect(routesByPath.get('/wards/:wardId/board')?.features).toEqual(
        expect.arrayContaining([
          'ward_task_board',
          'patient_chronicle',
          'wards',
          'inpatient_admissions',
          'nursing_workflows',
        ])
      )
    }
    expect(routesByPath.get('/workflows/ward-round')?.rustV2Supported).toBe(false)
    expect(routesByPath.get('/workflows/discharge')?.rustV2Supported).toBe(false)
    expect(routesByPath.get('/patients/:id/ward-round')?.rustV2Supported).toBe(false)
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
        features: ['patient_chronicle'],
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
