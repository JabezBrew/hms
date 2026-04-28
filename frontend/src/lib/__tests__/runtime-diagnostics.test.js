import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  formatRuntimeDiagnostics,
  getRuntimeDiagnostics,
  isChunkLoadError,
  publishRuntimeDiagnostics,
  sanitizePathname,
} from '../runtime-diagnostics'

describe('runtime-diagnostics', () => {
  const originalBuildInfo = globalThis.window.__HMS_BUILD_INFO__
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__

  beforeEach(() => {
    globalThis.window.__HMS_BUILD_INFO__ = {
      version: '1.4.2',
      commit: 'abc1234',
    }
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api',
      wsUrl: 'wss://realtime.example.com',
      defaultFacilityCode: 'main',
      multiFacilityMode: 'false',
    }
  })

  afterEach(() => {
    globalThis.window.__HMS_BUILD_INFO__ = originalBuildInfo
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig
  })

  it('sanitizes opaque route segments before publishing diagnostics', () => {
    expect(sanitizePathname('/patients/123e4567-e89b-12d3-a456-426614174000/chronicle')).toBe(
      '/patients/:id/chronicle',
    )
    expect(sanitizePathname('/inventory/items/ABCDEF1234567890')).toBe('/inventory/items/:id')
  })

  it('captures a sanitized runtime snapshot', () => {
    const diagnostics = getRuntimeDiagnostics({
      appState: 'authenticated',
      location: {
        pathname: '/patients/123e4567-e89b-12d3-a456-426614174000/chronicle',
        search: '?action=note&patient=secret',
        hash: '#labs',
        host: 'frontend.example.com',
      },
    })

    expect(diagnostics).toMatchObject({
      appState: 'authenticated',
      build: {
        version: '1.4.2',
        commit: 'abc1234',
      },
      location: {
        pathname: '/patients/:id/chronicle',
        searchKeys: ['action', 'patient'],
        hasHash: true,
        host: 'frontend.example.com',
      },
      runtime: {
        apiBaseUrl: 'https://api.example.com/api',
        wsUrl: 'wss://realtime.example.com',
      },
    })

    publishRuntimeDiagnostics({
      appState: 'authenticated',
      location: {
        pathname: '/patients/123e4567-e89b-12d3-a456-426614174000/chronicle',
        search: '?action=note',
        hash: '',
        host: 'frontend.example.com',
      },
    })

    expect(globalThis.window.__HMS_RUNTIME_DIAGNOSTICS__.location.pathname).toBe(
      '/patients/:id/chronicle',
    )
    expect(formatRuntimeDiagnostics()).toContain('"appState": "authenticated"')
  })

  it('detects dynamic import chunk failures', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('ChunkLoadError: Loading chunk 42 failed'))).toBe(true)
    expect(isChunkLoadError(new Error('Validation failed'))).toBe(false)
  })
})
