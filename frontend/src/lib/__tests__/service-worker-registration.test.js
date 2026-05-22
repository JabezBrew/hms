import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  registerStaticAssetServiceWorker,
  canRegisterStaticAssetServiceWorker,
} from '../service-worker-registration'

function loadStaticServiceWorker() {
  const source = readFileSync(path.resolve(process.cwd(), 'public/hms-static-sw.js'), 'utf8')
  const listeners = {}
  const cache = {
    match: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  }
  const cachesApi = {
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
    open: vi.fn().mockResolvedValue(cache),
  }
  const fetchApi = vi.fn().mockResolvedValue(new Response('asset', { status: 200 }))
  const selfObject = {
    location: { origin: 'https://hms.test' },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((type, callback) => {
      listeners[type] = callback
    }),
  }

  const policy = new Function(
    'self',
    'caches',
    'fetch',
    'URL',
    `${source}\nreturn { isApiPath, isCacheableStaticPath, isCacheableStaticRequest }`
  )(selfObject, cachesApi, fetchApi, URL)

  return {
    cache,
    cachesApi,
    fetchApi,
    listeners,
    policy,
  }
}

describe('static asset service worker', () => {
  it('never handles or caches API requests', () => {
    const { listeners, policy } = loadStaticServiceWorker()
    const request = new Request('https://hms.test/api/v2/patients?search=Ama')
    const respondWith = vi.fn()

    expect(policy.isApiPath('/api/v2/patients')).toBe(true)
    expect(policy.isCacheableStaticRequest(request)).toBe(false)

    listeners.fetch({ request, respondWith })

    expect(respondWith).not.toHaveBeenCalled()
  })

  it('caches only same-origin hashed static assets and icons', async () => {
    const { cache, cachesApi, fetchApi, listeners, policy } = loadStaticServiceWorker()
    const request = new Request('https://hms.test/assets/AuthenticatedApp-iv8zwIyq.js')
    const respondWith = vi.fn()

    expect(policy.isCacheableStaticRequest(request)).toBe(true)

    listeners.fetch({ request, respondWith })
    expect(respondWith).toHaveBeenCalledTimes(1)

    await respondWith.mock.calls[0][0]

    expect(cachesApi.open).toHaveBeenCalled()
    expect(fetchApi).toHaveBeenCalledWith(request)
    expect(cache.put).toHaveBeenCalledWith(request, expect.any(Response))
  })

  it('rejects un-hashed same-origin files from the runtime cache', () => {
    const { policy } = loadStaticServiceWorker()

    expect(
      policy.isCacheableStaticRequest(new Request('https://hms.test/src/main.jsx'))
    ).toBe(false)
    expect(
      policy.isCacheableStaticRequest(new Request('https://hms.test/runtime-config.js'))
    ).toBe(false)
  })
})

describe('service worker registration', () => {
  it('does not register when service workers are unsupported', async () => {
    const navigatorObject = {}
    const locationObject = { protocol: 'https:', hostname: 'hms.test' }

    expect(canRegisterStaticAssetServiceWorker({ navigatorObject, locationObject, force: true })).toBe(false)
    await expect(
      registerStaticAssetServiceWorker({ navigatorObject, locationObject, force: true })
    ).resolves.toBe(false)
  })

  it('registers the static asset worker on secure origins when forced or in production', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' })
    const navigatorObject = { serviceWorker: { register } }
    const locationObject = { protocol: 'https:', hostname: 'hms.test' }

    await expect(
      registerStaticAssetServiceWorker({ navigatorObject, locationObject, force: true })
    ).resolves.toEqual({ scope: '/' })

    expect(register).toHaveBeenCalledWith('/hms-static-sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
  })

  it('does not register on insecure non-local origins', async () => {
    const register = vi.fn()
    const navigatorObject = { serviceWorker: { register } }
    const locationObject = { protocol: 'http:', hostname: 'hospital.example' }

    await expect(
      registerStaticAssetServiceWorker({ navigatorObject, locationObject, force: true })
    ).resolves.toBe(false)
    expect(register).not.toHaveBeenCalled()
  })
})
