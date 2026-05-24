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
    v2Request
      .mockResolvedValueOnce({
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
            pressure_state: 'elevated',
          }],
          pool_waits: [{ p95_ms: 18 }],
          slow_query_fingerprints: [{
            fingerprint: 'SELECT * FROM patients WHERE email = "ama@example.com"',
            count: 2,
            total_ms: 900,
            avg_ms: 450,
            p95_ms: 500,
            p99_ms: 520,
          }],
          slow_queries_by_route: [{
            route_pattern: '/api/v2/patients/:id/chronicle',
            status_bucket: '2xx',
            facility_safe: 'MAIN',
            count: 2,
          }],
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
      .mockResolvedValueOnce({
        data: {
          routes: [{
            route_pattern: '/api/v2/patients/:id/chronicle',
            status_bucket: '2xx',
            facility_safe: 'MAIN',
            count: 14,
            p95_bytes: 65_536,
            p99_bytes: 131_072,
          }],
        },
      })
      .mockResolvedValueOnce({ data: { budgets: [] } })
      .mockResolvedValueOnce({
        data: {
          deploys: [{
            service: 'hms-api',
            version: '0.1.0',
            build_sha: 'abc123def4567890',
            image_tag: 'staging',
            environment: 'staging',
            started_at: '2026-05-23T10:00:00Z',
            deployed_at: '2026-05-23T10:01:00Z',
            status: 'running',
          }],
        },
      })
      .mockResolvedValueOnce({ data: { errors: [] } })
      .mockResolvedValueOnce({ data: { checks: [] } })

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
          pressure_state: 'elevated',
          wait_p95_ms: 18,
        }),
        pool_waits: expect.any(Array),
        slow_query_fingerprints: [
          expect.objectContaining({
            fingerprint: '_redacted_query_fingerprint_1',
            status: 'unknown',
            confidence: 'low',
          }),
        ],
        slow_queries_by_route: [
          expect.objectContaining({
            route: '/api/v2/patients/:id/chronicle',
            count: 2,
          }),
        ],
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
        commit: 'abc123def4567890',
        image_tag: 'staging',
        status: 'pass',
      }),
    })

    expect(v2Request).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      path: '/api/v2/ops/overview',
      query: { window: '1h' },
      signal,
    })
    expect(v2Request.mock.calls.map(([request]) => request.path)).toEqual([
      '/api/v2/ops/overview',
      '/api/v2/ops/payload',
      '/api/v2/ops/clinical-budgets',
      '/api/v2/ops/deploys',
      '/api/v2/ops/service-errors',
      '/api/v2/ops/edge-status',
    ])
  })

  it('preserves AbortError instead of wrapping it', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    v2Request.mockRejectedValueOnce(abortError)

    await expect(opsApi.getDashboard({}, { signal: new AbortController().signal })).rejects.toBe(abortError)
  })

  it('requests only Rust V2 ops drilldown endpoints with abort signals', async () => {
    const signal = new AbortController().signal
    v2Request
      .mockResolvedValueOnce({ data: { groups: {}, source: { generated_at: '2026-05-23T10:00:00Z' } } })
      .mockResolvedValueOnce({ data: { cache: {}, hydration: [] } })
      .mockResolvedValueOnce({ data: { routes: [] } })
      .mockResolvedValueOnce({ data: { pools: [], pool_waits: [] } })
      .mockResolvedValueOnce({ data: { fingerprints: [], slow_queries_by_route: [] } })
      .mockResolvedValueOnce({ data: { rum_enabled: true, rum: { all: [], api: [], navigation: [], app_shell: [] } } })

    await opsApi.getPerformance({ window: '6h' }, { signal })
    await opsApi.getDatabase({ window: '24h' }, { signal })
    await opsApi.getFrontend({ window: '5m' }, { signal })

    expect(v2Request).toHaveBeenNthCalledWith(1, {
      method: 'GET',
      path: '/api/v2/ops/route-latency',
      query: { window: '6h' },
      signal,
    })
    expect(v2Request).toHaveBeenNthCalledWith(2, {
      method: 'GET',
      path: '/api/v2/ops/request-context-cache',
      query: { window: '6h' },
      signal,
    })
    expect(v2Request).toHaveBeenNthCalledWith(3, {
      method: 'GET',
      path: '/api/v2/ops/payload',
      query: { window: '6h' },
      signal,
    })
    expect(v2Request).toHaveBeenNthCalledWith(4, {
      method: 'GET',
      path: '/api/v2/ops/db-pool',
      query: { window: '24h' },
      signal,
    })
    expect(v2Request).toHaveBeenNthCalledWith(5, {
      method: 'GET',
      path: '/api/v2/ops/slow-query-fingerprints',
      query: { window: '24h' },
      signal,
    })
    expect(v2Request).toHaveBeenNthCalledWith(6, {
      method: 'GET',
      path: '/api/v2/ops/rum',
      query: { window: '5m' },
      signal,
    })
    expect(v2Request.mock.calls.map(([request]) => request.path)).toEqual([
      '/api/v2/ops/route-latency',
      '/api/v2/ops/request-context-cache',
      '/api/v2/ops/payload',
      '/api/v2/ops/db-pool',
      '/api/v2/ops/slow-query-fingerprints',
      '/api/v2/ops/rum',
    ])
  })
})
