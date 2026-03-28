import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api-client';

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
});
