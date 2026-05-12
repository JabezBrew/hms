import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { encountersApi } from '../encounters';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 encounters bridge', () => {
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

  it('loads paginated encounters through Rust /api/v2 and adapts UI fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'encounter-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-MAIN-2026-000001',
              patient_display_name: 'Ama Mensah',
              visit_id: 'visit-1',
              encounter_type: 'outpatient',
              status: 'in_progress',
              started_at: '2026-05-12T08:00:00Z',
              ended_at: null,
            },
          ],
          page: { limit: 25, has_next: true, next_cursor: 'cursor-2' },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await encountersApi.getEncounters({ page_size: 25 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/encounters?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual({
      results: [
        expect.objectContaining({
          id: 'encounter-1',
          patient: 'patient-1',
          patient_id: 'patient-1',
          patient_name: 'Ama Mensah',
          patient_mrn: 'MRN-MAIN-2026-000001',
          status: 'in-progress',
          v2_status: 'in_progress',
          start_time: '2026-05-12T08:00:00Z',
        }),
      ],
      page: 1,
      page_size: 25,
      count: 2,
      total: 2,
      count_exact: false,
      next: 'cursor-2',
      previous: null,
      next_cursor: 'cursor-2',
    });
  });

  it('loads patient-scoped encounters through Rust /api/v2 with patient access enforced server-side', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'encounter-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-1',
              patient_display_name: 'Ama Mensah',
              visit_id: null,
              encounter_type: 'emergency',
              status: 'completed',
              started_at: '2026-05-12T08:00:00Z',
              ended_at: '2026-05-12T09:00:00Z',
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

    const response = await encountersApi.getEncountersForPatient('patient-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/encounters?limit=50&patient_id=patient-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'encounter-1',
        patient_id: 'patient-1',
        status: 'finished',
        encounter_type: 'emergency',
      }),
    ]);
  });

  it('creates, updates, cancels, and completes encounters through Rust /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'encounter-1', status: 'in_progress' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'encounter-1', encounter_type: 'emergency' }, meta: {} }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'encounter-1', status: 'cancelled' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'encounter-2', status: 'completed' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    await encountersApi.createEncounter({
      patient: 'patient-1',
      visit: 'visit-1',
      encounter_type: 'outpatient',
    });
    await encountersApi.updateEncounter('encounter-1', { encounter_type: 'emergency' });
    await encountersApi.cancelEncounter('encounter-1');
    await encountersApi.completeEncounter('encounter-2');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/encounters',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          patient_id: 'patient-1',
          visit_id: 'visit-1',
          encounter_type: 'outpatient',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/encounters/encounter-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          visit_id: null,
          encounter_type: 'emergency',
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/encounters/encounter-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/encounters/encounter-2/complete',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('preserves AbortError from Rust patient encounter calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      encountersApi.getEncountersForPatient('patient-1', { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
