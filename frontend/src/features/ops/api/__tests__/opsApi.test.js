import { beforeEach, describe, expect, it, vi } from 'vitest'
import { opsApi } from '../index'
import { v2Request } from '@/lib/api/v2/client'

vi.mock('@/lib/api/v2/client', () => ({
  v2Request: vi.fn(),
}))

vi.mock('@/lib/api/v2/errors', () => ({
  handleV2ApiError: (error, fallback) => error?.message || fallback,
}))

describe('opsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests the Rust V2 ops dashboard with the TanStack Query abort signal', async () => {
    const signal = new AbortController().signal
    v2Request.mockResolvedValueOnce({
      data: {
        runtime: {
          service: 'hms-api',
          version: '0.1.0',
          started_at: '2026-05-23T10:00:00Z',
        },
        api: {
          ready: true,
          dependencies: [{ name: 'postgres', ready: true }],
        },
        database: {
          pools: [{
            name: 'primary',
            in_use: 7,
            max_connections: 10,
            pressure: 0.7,
          }],
          pool_waits: [{ p95_ms: 18 }],
        },
        performance: {
          routes: {
            chronicle: [{
              route_pattern: '/api/v2/patients/:id/chronicle',
              status_bucket: '2xx',
              facility_safe: 'MAIN',
              count: 14,
              p95_ms: 120,
              p99_ms: 180,
            }],
          },
          request_context_cache: {
            hits_total: 95,
            misses_total: 5,
            hit_rate: 0.95,
          },
          payloads: [{
            route_pattern: '/api/v2/patients/:id/chronicle',
            status_bucket: '2xx',
            facility_safe: 'MAIN',
            p95_bytes: 65_536,
            p99_bytes: 131_072,
          }],
        },
        frontend: {
          rum_enabled: true,
          rum: {
            all: [{ count: 20 }],
            api: [{ p95_ms: 210, p99_ms: 420 }],
            app_shell: [{ p95_ms: 820 }],
          },
        },
        source: {
          generated_at: '2026-05-23T10:25:00Z',
          window: 'current_process_lifetime',
        },
      },
    })

    await expect(opsApi.getDashboard({ window: '1h' }, { signal })).resolves.toMatchObject({
      generated_at: '2026-05-23T10:25:00Z',
      budgets: expect.arrayContaining([
        expect.objectContaining({ key: 'api-p99', status: 'pass' }),
        expect.objectContaining({ key: 'db-pool', status: 'warn' }),
      ]),
      performance: {
        routes: [expect.objectContaining({
          route: '/api/v2/patients/:id/chronicle',
          requests: 14,
          payload_p95_kb: 64,
          payload_p99_kb: 128,
        })],
        request_context_cache: expect.objectContaining({
          hit_ratio: 0.95,
          hits: 95,
          misses: 5,
        }),
        payloads: expect.objectContaining({
          p95_kb: 64,
          p99_kb: 128,
        }),
      },
      database: {
        pool: expect.objectContaining({
          used: 7,
          max: 10,
          pressure: 0.7,
          wait_p95_ms: 18,
        }),
        pool_waits: expect.any(Array),
        slow_query_fingerprints: expect.any(Array),
      },
      frontend: {
        rum: expect.objectContaining({
          app_shell_p95_ms: 820,
          browser_api_p95_ms: 210,
          browser_api_p99_ms: 420,
          sample_count: 20,
        }),
        rum_enabled: true,
      },
      deploys: expect.objectContaining({
        version: '0.1.0',
        status: 'pass',
      }),
    })

    expect(v2Request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/v2/ops/overview',
      query: { window: '1h' },
      signal,
    })
  })

  it('preserves AbortError instead of wrapping it', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    v2Request.mockRejectedValueOnce(abortError)

    await expect(opsApi.getDashboard({}, { signal: new AbortController().signal })).rejects.toBe(abortError)
  })
})
