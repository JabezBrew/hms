import { describe, expect, it } from 'vitest'

import {
  dashboardFeaturesForRole,
  filterDashboardItemsByFeature,
  getHrefFeatureRequirements,
  nursingHomeFeaturesForFeatures,
  nursingHomeForFeatures,
} from './moduleGates'

describe('dashboard module gates', () => {
  it('maps role dashboards to backing modules', () => {
    expect(dashboardFeaturesForRole('doctor')).toEqual([])
    expect(dashboardFeaturesForRole('inpatient_doctor')).toEqual([])
    expect(dashboardFeaturesForRole('nurse')).toEqual([])
    expect(dashboardFeaturesForRole('admin')).toEqual([])
  })

  it('resolves nurse home to the available embedded workflow surface', () => {
    expect(nursingHomeForFeatures({
      ward_task_board: true,
      patient_chronicle: true,
      wards: true,
      inpatient_admissions: true,
      nursing_workflows: true,
    })).toBe('/ward-board')
    expect(nursingHomeForFeatures({ emergency_encounters: true })).toBe('/triage')
    expect(nursingHomeForFeatures({ outpatient_encounters: true })).toBe('/encounters')
    expect(nursingHomeForFeatures({ patient_chronicle: true })).toBe('/patients')
    expect(nursingHomeFeaturesForFeatures({ emergency_encounters: true })).toEqual([
      'emergency_encounters',
    ])
  })

  it('derives feature requirements from dashboard action links', () => {
    expect(getHrefFeatureRequirements('/referrals/inbox')).toEqual(['referrals'])
    expect(getHrefFeatureRequirements('/care-areas/outpatient')).toEqual(['outpatient_encounters'])
    expect(getHrefFeatureRequirements('/care-areas/emergency')).toEqual(['emergency_encounters'])
    expect(getHrefFeatureRequirements('/care-areas/inpatient')).toEqual(
      expect.arrayContaining(['ward_task_board', 'patient_chronicle', 'wards'])
    )
    expect(getHrefFeatureRequirements('/encounters?tab=emergency')).toEqual(
      expect.arrayContaining(['outpatient_encounters', 'emergency_encounters'])
    )
    expect(getHrefFeatureRequirements('/encounters?tab=outpatient')).toEqual(['outpatient_encounters'])
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
      { label: 'Emergency encounters', href: '/encounters?tab=emergency' },
      { label: 'Always', href: '/settings' },
    ]

    expect(filterDashboardItemsByFeature(items, enabledFeatures).map((item) => item.label)).toEqual([
      'Billing',
      'Always',
    ])
  })
})
