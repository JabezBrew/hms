import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api-client';
import { laboratoryApi } from '../api/laboratory';
import { __resetRumForTests, flushRum } from '../observability/rum';

describe('apiClient runtime config integration', () => {
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;
  const originalFetch = globalThis.fetch;
  const originalSendBeacon = globalThis.navigator.sendBeacon;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api',
    };
    globalThis.fetch = vi.fn();
    globalThis.navigator.sendBeacon = vi.fn(() => true);
    __resetRumForTests();
  });

  afterEach(() => {
    __resetRumForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
    globalThis.navigator.sendBeacon = originalSendBeacon;
    vi.clearAllMocks();
  });

  it('uses runtime api base for ordinary requests', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await apiClient.get('/patients/');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/patients/',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('normalizes absolute next-page URLs against the configured API base', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ id: 1 }],
            next: 'https://api.example.com/api/patients/?page=2',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [{ id: 2 }],
            next: null,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const data = await apiClient.getAll('/patients/');

    expect(data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/patients/',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/api/patients/?page=2',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('stops paginated fetch chains when the request is aborted', async () => {
    const controller = new AbortController();

    globalThis.fetch.mockImplementationOnce(async () => {
      controller.abort();
      return new Response(
        JSON.stringify({
          results: [{ id: 1 }],
          next: 'https://api.example.com/api/patients/?page=2',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    await expect(apiClient.getAll('/patients/', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves abort errors through the laboratory API wrapper', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      laboratoryApi.getLabOrdersPaginated({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('records API timing without changing the response shape', async () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api',
      rumEnabled: true,
    };
    globalThis.navigator.sendBeacon = vi.fn(() => false);
    globalThis.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ results: [{ id: 1 }], next: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const data = await apiClient.get('/patients/PAT-928374/chronicle/', {
      params: { tab: 'labs' },
    });
    expect(data).toEqual([{ id: 1 }]);

    await vi.waitFor(() => {
      flushRum();
      expect(globalThis.navigator.sendBeacon).toHaveBeenCalledTimes(1);
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const [, request] = globalThis.fetch.mock.calls[1];
    expect(JSON.parse(request.body)).toMatchObject({
      events: [
        {
          type: 'api',
          name: 'duration',
          route: '/patients/:id/chronicle',
          status: '2xx',
          facility_safe: '_unknown',
        },
      ],
    });
  });
});
