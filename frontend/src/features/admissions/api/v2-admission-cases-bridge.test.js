import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { admissionsApi } from './index';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 admission cases bridge', () => {
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

  it('loads admission cases through Rust /api/v2 and adapts queue fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'case-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              ward_id: 'ward-1',
              ward_name: 'Medical Ward',
              bed_id: 'bed-1',
              bed_code: 'A1',
              status: 'ready_for_activation',
              created_at: '2026-05-12T05:00:00Z',
              admitted_at: null,
              discharged_at: null,
            },
          ],
          page: { limit: 25, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const cases = await admissionsApi.getCases({}, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admissions/cases?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(cases).toEqual([
      expect.objectContaining({
        id: 'case-1',
        patient: 'patient-1',
        patient_name: 'Ama Mensah',
        medical_record_number: 'MRN-001',
        requested_ward: 'ward-1',
        requested_ward_name: 'Medical Ward',
        requested_bed_label: 'Medical Ward · Bed A1',
        status: 'ready_for_activation',
        requested_at: '2026-05-12T05:00:00Z',
        blockers: [],
      }),
    ]);
  });

  it('preserves AbortError from Rust admission case list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      admissionsApi.getCases({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
