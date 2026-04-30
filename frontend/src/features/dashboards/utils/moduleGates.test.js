import { describe, expect, it } from 'vitest'

import {
  dashboardFeaturesForRole,
  filterDashboardItemsByFeature,
  getHrefFeatureRequirements,
} from './moduleGates'

describe('dashboard module gates', () => {
  it('maps role dashboards to backing modules', () => {
    expect(dashboardFeaturesForRole('doctor')).toEqual(['outpatient_encounters'])
    expect(dashboardFeaturesForRole('inpatient_doctor')).toEqual(['inpatient_admissions'])
    expect(dashboardFeaturesForRole('nurse')).toEqual(['nursing_workflows'])
    expect(dashboardFeaturesForRole('admin')).toEqual([])
  })

  it('derives feature requirements from dashboard action links', () => {
    expect(getHrefFeatureRequirements('/referrals/inbox')).toEqual(['referrals'])
    expect(getHrefFeatureRequirements('/patients/123?action=ward_round')).toEqual(
      expect.arrayContaining(['patient_chronicle', 'wards'])
    )
    expect(getHrefFeatureRequirements('/workflows/discharge')).toEqual(['discharge_workflows'])
  })

  it('filters dashboard items when their module is disabled', () => {
    const enabledFeatures = {
      billing: true,
      referrals: false,
    }
    const items = [
      { label: 'Billing', href: '/billing' },
      { label: 'Referrals', href: '/referrals/inbox' },
      { label: 'Always', href: '/settings' },
    ]

    expect(filterDashboardItemsByFeature(items, enabledFeatures).map((item) => item.label)).toEqual([
      'Billing',
      'Always',
    ])
  })
})
