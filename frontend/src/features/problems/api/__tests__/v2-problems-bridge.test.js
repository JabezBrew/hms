import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { problemsApi } from '../index';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 problems bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({
      getAccessToken: () => 'access-token-123',
      getFacilityCode: () => 'HMS',
    });
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('loads patient problems through Rust /api/v2 and adapts the UI fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'problem-1',
              patient_id: 'patient-1',
              label: 'Hypertension',
              status: 'active',
              onset_date: '2026-05-01',
              created_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 50, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await problemsApi.listForPatient('patient-1', { include_resolved: '1' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/problems?limit=50',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'problem-1',
        patient: 'patient-1',
        patient_id: 'patient-1',
        label: 'Hypertension',
        clinical_status: 'active',
        status: 'active',
        priority: 'medium',
        verification_status: 'confirmed',
      }),
    ]);
  });

  it('creates free-text patient problems through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'problem-2',
            patient_id: 'patient-1',
            label: 'Asthma',
            status: 'active',
            onset_date: null,
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await problemsApi.create({
      patient: 'patient-1',
      free_text_label: 'Asthma',
      priority: 'high',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/problems',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          label: 'Asthma',
          onset_date: null,
        }),
      }),
    );
  });

  it('changes patient problem status through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'problem-1',
            patient_id: 'patient-1',
            label: 'Hypertension',
            status: 'resolved',
            onset_date: '2026-05-01',
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await problemsApi.changeStatus('problem-1', {
      status: 'resolved',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinical/problems/problem-1/status',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          status: 'resolved',
        }),
      }),
    );
    expect(response).toEqual(
      expect.objectContaining({
        id: 'problem-1',
        patient: 'patient-1',
        clinical_status: 'resolved',
        status: 'resolved',
      }),
    );
  });

  it('does not call legacy problem catalog or link endpoints in Rust mode', async () => {
    await expect(problemsApi.searchCodes('hyp')).resolves.toEqual([]);
    await expect(problemsApi.listLinks({ patient: 'patient-1' })).resolves.toEqual([]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves AbortError from Rust problem list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      problemsApi.listForPatient('patient-1', {}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
