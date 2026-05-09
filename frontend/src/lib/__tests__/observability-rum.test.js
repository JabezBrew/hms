import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRumForTests,
  flushRum,
  initBrowserRum,
  recordApiTiming,
  scrubRouteLabel,
} from '../observability/rum';

describe('browser RUM observability', () => {
  const originalFetch = globalThis.fetch;
  const originalSendBeacon = globalThis.navigator.sendBeacon;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    vi.stubEnv('VITE_RUM_ENABLED', '');
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {};
    globalThis.fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    globalThis.navigator.sendBeacon = vi.fn(() => true);
    __resetRumForTests();
  });

  afterEach(() => {
    __resetRumForTests();
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
    globalThis.navigator.sendBeacon = originalSendBeacon;
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    vi.clearAllMocks();
  });

  it('scrubs routes down to safe templates without query strings or identifiers', () => {
    expect(scrubRouteLabel('/patients/PAT-928374/chronicle?tab=labs')).toBe('/patients/:id/chronicle');
    expect(scrubRouteLabel('/wards/admissions/550e8400-e29b-41d4-a716-446655440000')).toBe('/wards/admissions/:id');
    expect(scrubRouteLabel('/billing/invoices/12345/payments')).toBe('/billing/invoices/:id/payments');
  });

  it('stays disabled by default', () => {
    expect(initBrowserRum()).toBe(false);

    recordApiTiming({
      endpoint: '/patients/123/?search=hidden',
      method: 'GET',
      durationMs: 25,
      status: 200,
    });
    flushRum();

    expect(globalThis.navigator.sendBeacon).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('batches safe API timing events when runtime config enables RUM', async () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api',
      rumEnabled: true,
    };
    globalThis.navigator.sendBeacon = vi.fn(() => false);

    recordApiTiming({
      endpoint: '/patients/PAT-928374/chronicle?tab=labs',
      method: 'GET',
      durationMs: 42.7,
      status: 200,
    });
    expect(flushRum()).toBe(true);

    expect(globalThis.navigator.sendBeacon).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/observability/rum/');
    expect(JSON.parse(request.body)).toMatchObject({
      events: [
        {
          type: 'api',
          name: 'duration',
          route: '/patients/:id/chronicle',
          method: 'get',
          status: '200',
          value: 43,
        },
      ],
    });
  });
});
