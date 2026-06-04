import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  COCKPIT_CACHE_CATEGORIES,
  CockpitCacheSecurityError,
  __resetCockpitCacheForTests,
  __setCockpitCacheAdapterForTests,
  clearAllCockpitCaches,
  createCockpitCacheScope,
  estimateCockpitStorage,
  getCockpitCacheEntry,
  putCockpitCacheEntry,
  setCockpitCacheTelemetryHook,
} from '../cockpit-cache'

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryAdapter() {
  const records = new Map()

  return {
    async getRecord(id) {
      return clone(records.get(id) || null)
    },
    async putRecord(record) {
      records.set(record.id, clone(record))
    },
    async deleteRecord(id) {
      records.delete(id)
    },
    async listRecords() {
      return Array.from(records.values()).map(clone)
    },
    async clearRecords() {
      records.clear()
    },
  }
}

const scope = {
  deploymentVersion: 'test-build',
  userId: 'user-123',
  facilityCode: 'hms',
}

describe('cockpit cache', () => {
  beforeEach(() => {
    __setCockpitCacheAdapterForTests(createMemoryAdapter())
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn().mockResolvedValue({ usage: 512, quota: 4096 }),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    __resetCockpitCacheForTests()
  })

  it('stores and reads explicitly non-PHI cockpit metadata by deployment, user, and facility scope', async () => {
    const cacheScope = createCockpitCacheScope(scope)

    await putCockpitCacheEntry(
      cacheScope,
      COCKPIT_CACHE_CATEGORIES.COMMAND_REGISTRY,
      'global-actions',
      {
        commands: [
          { id: 'open-ward-board', label: 'Open ward board', route: '/ward-board' },
        ],
      },
      { nonPhi: true }
    )

    await expect(
      getCockpitCacheEntry(
        { ...scope, facilityCode: 'satellite' },
        COCKPIT_CACHE_CATEGORIES.COMMAND_REGISTRY,
        'global-actions'
      )
    ).resolves.toBeNull()

    await expect(
      getCockpitCacheEntry(
        scope,
        COCKPIT_CACHE_CATEGORIES.COMMAND_REGISTRY,
        'global-actions'
      )
    ).resolves.toEqual({
      commands: [
        { id: 'open-ward-board', label: 'Open ward board', route: '/ward-board' },
      ],
    })
  })

  it('rejects PHI-like clinical fixtures before they reach IndexedDB', async () => {
    await expect(
      putCockpitCacheEntry(
        scope,
        COCKPIT_CACHE_CATEGORIES.ROUTE_MANIFEST,
        'patient-fixture',
        {
          patientId: 'PAT-2026-0001',
          mrn: 'MRN-12345',
          diagnosis: 'malaria',
        },
        { nonPhi: true }
      )
    ).rejects.toBeInstanceOf(CockpitCacheSecurityError)
  })

  it('requires safe static catalogs to be explicitly marked non-PHI', async () => {
    await expect(
      putCockpitCacheEntry(
        scope,
        COCKPIT_CACHE_CATEGORIES.STATIC_CATALOG,
        'departments',
        {
          entries: [{ code: 'front-desk', label: 'Front desk' }],
        },
        { nonPhi: true }
      )
    ).rejects.toThrow(/non-PHI marker/)

    await expect(
      putCockpitCacheEntry(
        scope,
        COCKPIT_CACHE_CATEGORIES.STATIC_CATALOG,
        'departments',
        {
          nonPhi: true,
          entries: [{ code: 'front-desk', label: 'Front desk' }],
        },
        { nonPhi: true }
      )
    ).resolves.toBe(true)
  })

  it('evicts least recently used entries when the storage budget is exceeded', async () => {
    vi.useFakeTimers()
    const options = { nonPhi: true, ttlMs: 60_000, maxBytes: 420 }

    vi.setSystemTime(1_000)
    await putCockpitCacheEntry(
      scope,
      COCKPIT_CACHE_CATEGORIES.UI_PREFERENCES,
      'first',
      { density: 'compact', marker: 'A'.repeat(90) },
      options
    )

    vi.setSystemTime(2_000)
    await putCockpitCacheEntry(
      scope,
      COCKPIT_CACHE_CATEGORIES.UI_PREFERENCES,
      'second',
      { density: 'comfortable', marker: 'B'.repeat(90) },
      options
    )

    vi.setSystemTime(3_000)
    await putCockpitCacheEntry(
      scope,
      COCKPIT_CACHE_CATEGORIES.UI_PREFERENCES,
      'third',
      { density: 'dense', marker: 'C'.repeat(90) },
      options
    )

    await expect(
      getCockpitCacheEntry(scope, COCKPIT_CACHE_CATEGORIES.UI_PREFERENCES, 'first')
    ).resolves.toBeNull()
    await expect(
      getCockpitCacheEntry(scope, COCKPIT_CACHE_CATEGORIES.UI_PREFERENCES, 'second')
    ).resolves.toMatchObject({ density: 'comfortable' })
    await expect(
      getCockpitCacheEntry(scope, COCKPIT_CACHE_CATEGORIES.UI_PREFERENCES, 'third')
    ).resolves.toMatchObject({ density: 'dense' })
  })

  it('emits storage estimate telemetry without user identifiers', async () => {
    const telemetry = vi.fn()
    const cacheScope = createCockpitCacheScope(scope)
    setCockpitCacheTelemetryHook(telemetry)

    const event = await estimateCockpitStorage('write', cacheScope)

    expect(event).toMatchObject({
      name: 'cockpit_cache.storage_estimate',
      reason: 'write',
      usageBytes: 512,
      quotaBytes: 4096,
      facilitySafe: 'HMS',
      userScoped: true,
    })
    expect(event).not.toHaveProperty('userId')
    expect(telemetry).toHaveBeenCalledWith(event)
  })

  it('clears all cockpit records on auth lifecycle cleanup', async () => {
    await putCockpitCacheEntry(
      scope,
      COCKPIT_CACHE_CATEGORIES.FEATURE_METADATA,
      'features',
      { enabled: ['wards'] },
      { nonPhi: true }
    )

    await clearAllCockpitCaches({ reason: 'logout' })

    await expect(
      getCockpitCacheEntry(scope, COCKPIT_CACHE_CATEGORIES.FEATURE_METADATA, 'features')
    ).resolves.toBeNull()
  })
})
