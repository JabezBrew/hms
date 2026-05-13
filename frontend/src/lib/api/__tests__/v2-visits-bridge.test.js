import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clinicWalkInApi } from '@/features/clinics/api';

import { visitsApi, triageApi } from '../visits';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 visits and triage bridge', () => {
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

  it('loads the clinic waiting room through Rust /api/v2 with clinic cursor filtering', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'visit-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-MAIN-2026-000001',
              patient_display_name: 'Ama Mensah',
              appointment_id: null,
              clinic_id: 'clinic-1',
              status: 'waiting',
              checked_in_at: '2026-05-12T08:00:00Z',
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

    const response = await visitsApi.waitingRoom('clinic-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/visits?limit=50&clinic_id=clinic-1',
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
      {
        id: 'visit-1',
        visit_id: 'visit-1',
        encounter_id: 'visit-1',
        patient: 'patient-1',
        patient_id: 'patient-1',
        patient_name: 'Ama Mensah',
        patient_identifier: 'MRN-MAIN-2026-000001',
        patient_mrn: 'MRN-MAIN-2026-000001',
        patient_details: {
          id: 'patient-1',
          user_details: {
            first_name: 'Ama',
            last_name: 'Mensah',
          },
        },
        appointment: null,
        appointment_id: null,
        clinic_id: 'clinic-1',
        queue_number: 1,
        visit_status: 'waiting',
        v2_status: 'waiting',
        checked_in_at: '2026-05-12T08:00:00Z',
      },
    ]);
  });

  it('checks in walk-ins through the Rust visit check-in contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'visit-2',
            patient_id: 'patient-2',
            patient_code: 'MRN-MAIN-2026-000002',
            patient_display_name: 'Kojo Boateng',
            appointment_id: null,
            clinic_id: 'clinic-1',
            status: 'waiting',
            checked_in_at: '2026-05-12T08:15:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await clinicWalkInApi.checkIn({
      patientId: 'patient-2',
      clinicId: 'clinic-1',
      reason: 'Review',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/visits/check-in',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          patient_id: 'patient-2',
          clinic_id: 'clinic-1',
        }),
      }),
    );
    expect(response).toMatchObject({
      id: 'visit-2',
      patient_id: 'patient-2',
      patient_name: 'Kojo Boateng',
      clinic_id: 'clinic-1',
      visit_status: 'waiting',
    });
  });

  it('runs visit lifecycle actions through Rust /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'visit-1', status: 'called' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'visit-1', status: 'in_consultation' }, meta: {} }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'visit-1', status: 'on_hold' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { id: 'visit-1', status: 'ready_checkout' }, meta: {} }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'visit-1', status: 'checked_out' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: 'visit-2', status: 'no_show' }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    await visitsApi.call('visit-1');
    await visitsApi.startConsultation('visit-1');
    await visitsApi.hold('visit-1');
    await visitsApi.endConsultation('visit-1');
    await visitsApi.checkout('visit-1');
    await visitsApi.noShow('visit-2');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/visits/visit-1/call',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/visits/visit-1/start-consultation',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/visits/visit-1/hold',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/visits/visit-1/ready-checkout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'http://localhost:8080/api/v2/visits/visit-1/checkout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      6,
      'http://localhost:8080/api/v2/visits/visit-2/no-show',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('loads and creates triage queue entries through Rust /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'triage-1',
                visit_id: 'visit-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-MAIN-2026-000001',
                patient_display_name: 'Ama Mensah',
                acuity: 'urgent',
                status: 'completed',
                created_at: '2026-05-12T08:30:00Z',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'triage-2',
              visit_id: 'visit-2',
              patient_id: 'patient-2',
              patient_code: 'MRN-MAIN-2026-000002',
              patient_display_name: 'Kojo Boateng',
              acuity: 'emergency',
              status: 'waiting',
              created_at: '2026-05-12T08:45:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const list = await triageApi.list();
    const created = await triageApi.create({ visit_id: 'visit-2', priority: 'emergency' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/triage?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(list).toEqual({
      results: [
        expect.objectContaining({
          id: 'triage-1',
          visit_id: 'visit-1',
          patient: 'patient-1',
          patient_id: 'patient-1',
          patient_name: 'Ama Mensah',
          priority: 'urgent',
          status: 'triaged',
        }),
      ],
      page: 1,
      page_size: 50,
      count: 1,
      total: 1,
      count_exact: false,
      next: null,
      previous: null,
      next_cursor: null,
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/triage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          visit_id: 'visit-2',
          acuity: 'emergency',
        }),
      }),
    );
    expect(created).toMatchObject({
      id: 'triage-2',
      visit_id: 'visit-2',
      patient_name: 'Kojo Boateng',
      priority: 'emergency',
      status: 'waiting',
    });
  });

  it('loads triage entry detail through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'triage-1',
            visit_id: 'visit-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            patient_display_name: 'Ama Mensah',
            acuity: 'urgent',
            status: 'waiting',
            created_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const detail = await triageApi.get('triage-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/triage/triage-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(detail).toMatchObject({
      id: 'triage-1',
      patient: 'patient-1',
      patient_name: 'Ama Mensah',
      status: 'waiting',
      priority: 'urgent',
    });
  });

  it('saves triage assessment through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'triage-1',
            visit_id: 'visit-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            patient_display_name: 'Ama Mensah',
            acuity: 'emergency',
            status: 'completed',
            triage_notes: 'Chest pain and diaphoresis.',
            created_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const assessed = await triageApi.triage('triage-1', {
      priority: 'emergency',
      notes: 'Chest pain and diaphoresis.',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/triage/triage-1/assessment',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          acuity: 'emergency',
          notes: 'Chest pain and diaphoresis.',
        }),
      }),
    );
    expect(assessed).toMatchObject({
      id: 'triage-1',
      priority: 'emergency',
      status: 'triaged',
      triage_notes: 'Chest pain and diaphoresis.',
    });
  });

  it('cancels triage entries through Rust /api/v2 instead of the legacy endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'triage-1',
            visit_id: 'visit-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            patient_display_name: 'Ama Mensah',
            acuity: 'urgent',
            status: 'cancelled',
            created_at: '2026-05-12T08:30:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const cancelled = await triageApi.cancel('triage-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/triage/triage-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(cancelled).toMatchObject({
      id: 'triage-1',
      status: 'cancelled',
      priority: 'urgent',
    });
  });

  it('preserves AbortError from Rust waiting-room calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      visitsApi.waitingRoom('clinic-1', { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
