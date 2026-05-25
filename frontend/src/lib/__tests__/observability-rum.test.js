import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRumForTests,
  configureRumAuth,
  flushRum,
  initBrowserRum,
  recordApiTiming,
  scrubRouteLabel,
} from '../observability/rum';

describe('browser RUM observability', () => {
  const originalFetch = globalThis.fetch;
  const originalSendBeacon = globalThis.navigator.sendBeacon;
  const originalPerformanceObserver = globalThis.PerformanceObserver;
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
    globalThis.PerformanceObserver = originalPerformanceObserver;
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('scrubs routes down to safe templates without query strings or identifiers', () => {
    expect(scrubRouteLabel('/patients/PAT-928374/chronicle?tab=labs')).toBe('/patients/:id/chronicle');
    expect(scrubRouteLabel('/wards/admissions/550e8400-e29b-41d4-a716-446655440000')).toBe('/wards/admissions/:id');
    expect(scrubRouteLabel('/billing/invoices/12345/payments')).toBe('/billing/invoices/:id/payments');
    expect(scrubRouteLabel('/patients/ama-mensah/chronicle')).toBe('/patients/:id/chronicle');
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
    configureRumAuth({ getFacilityCode: () => 'HMS' });

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
          status: '2xx',
          facility_safe: 'HMS',
          value: 43,
        },
      ],
    });
  });

  it('uses the Rust V2 observability endpoint in Rust API mode', () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api',
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'https://api.example.com/api/v2',
      rumEnabled: true,
    };
    globalThis.navigator.sendBeacon = vi.fn(() => false);

    recordApiTiming({
      endpoint: '/wards/123/board',
      method: 'POST',
      durationMs: 31,
      status: 204,
    });
    expect(flushRum()).toBe(true);

    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/v2/observability/rum');
  });

  it('captures long tasks as PHI-safe web vital events', () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api',
      rumEnabled: true,
    };
    globalThis.navigator.sendBeacon = vi.fn(() => false);
    let observerCallback;
    class FakePerformanceObserver {
      static supportedEntryTypes = ['longtask'];

      constructor(callback) {
        observerCallback = callback;
      }

      observe() {}
    }
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver);

    expect(initBrowserRum()).toBe(true);
    observerCallback({
      getEntries: () => [{ duration: 127.4 }],
    });
    expect(flushRum()).toBe(true);

    const [, request] = globalThis.fetch.mock.calls[0];
    const payload = JSON.parse(request.body);
    expect(payload.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'web-vital',
        name: 'long-task',
        route: '/',
        value: 127,
      }),
    ]));
  });
});
