import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api-client';
import { laboratoryApi } from '../api/laboratory';

describe('apiClient runtime config integration', () => {
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.example.com/api',
    };
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
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
});
