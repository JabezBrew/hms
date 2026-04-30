import { describe, expect, it } from 'vitest'
import { areFeaturesEnabled, featureList, withFeature } from '../features'

describe('feature helpers', () => {
  it('normalizes feature requirements', () => {
    expect(featureList()).toEqual([])
    expect(featureList('wards')).toEqual(['wards'])
    expect(featureList(['wards', 'billing'])).toEqual(['wards', 'billing'])
  })

  it('fails closed when feature keys are missing or disabled', () => {
    expect(areFeaturesEnabled(['wards'])).toBe(false)
    expect(areFeaturesEnabled(['wards'], undefined)).toBe(false)
    expect(areFeaturesEnabled(['wards'], {})).toBe(false)
    expect(areFeaturesEnabled(['wards'], { wards: true })).toBe(true)
    expect(areFeaturesEnabled(['wards'], { wards: false })).toBe(false)
    expect(areFeaturesEnabled(['wards', 'billing'], { wards: true, billing: false })).toBe(false)
  })

  it('adds route-level feature metadata without dropping existing requirements', () => {
    const routes = withFeature([{ path: '/billing/discharges', features: ['discharge_workflows'] }], 'billing')

    expect(routes[0].features).toEqual(['discharge_workflows', 'billing'])
  })
})
