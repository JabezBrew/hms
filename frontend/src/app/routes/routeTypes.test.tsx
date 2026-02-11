import { describe, it, expect } from 'vitest'
import { featureRoutes } from './featureRoutes'


describe('featureRoutes', () => {
  it('declares roles and layout for each route', () => {
    featureRoutes.forEach((route) => {
      expect(route.path).toBeTruthy()
      expect(route.component).toBeTruthy()
      expect(route.layout).toBeTruthy()
      expect(route.roles).not.toBeUndefined()
    })
  })
})
