import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOpsDashboardHost, isStandaloneOpsDashboardHost } from '../host'

describe('isOpsDashboardHost', () => {
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__

  beforeEach(() => {
    vi.stubEnv('VITE_OPS_DASHBOARD_HOSTS', '')
    globalThis.window.__HMS_RUNTIME_CONFIG__ = undefined
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig
  })

  it('allows local development and explicit ops subdomains', () => {
    expect(isOpsDashboardHost('localhost')).toBe(true)
    expect(isOpsDashboardHost('127.0.0.1')).toBe(true)
    expect(isOpsDashboardHost('::1')).toBe(true)
    expect(isOpsDashboardHost('ops.staging.thehms.systems')).toBe(true)
  })

  it('rejects normal hospital app hosts', () => {
    expect(isOpsDashboardHost('staging.thehms.systems')).toBe(false)
    expect(isOpsDashboardHost('thehms.systems')).toBe(false)
    expect(isOpsDashboardHost('app.client-hospital.example')).toBe(false)
  })

  it('honors configured ops hosts exactly when runtime config is set', () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      opsDashboardHosts: 'status.client.example,ops.client.example',
    }

    expect(isOpsDashboardHost('status.client.example')).toBe(true)
    expect(isOpsDashboardHost('ops.client.example')).toBe(true)
    expect(isOpsDashboardHost('ops.staging.thehms.systems')).toBe(false)
  })

  it('uses the standalone ops app only for real ops hostnames', () => {
    expect(isStandaloneOpsDashboardHost('localhost')).toBe(false)
    expect(isStandaloneOpsDashboardHost('127.0.0.1')).toBe(false)
    expect(isStandaloneOpsDashboardHost('ops.staging.thehms.systems')).toBe(true)

    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      opsDashboardHosts: 'localhost,ops.client.example',
    }

    expect(isStandaloneOpsDashboardHost('localhost')).toBe(false)
    expect(isStandaloneOpsDashboardHost('ops.client.example')).toBe(true)
  })
})
