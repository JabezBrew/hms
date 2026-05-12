import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appointmentsApi } from '../appointments';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 appointments bridge', () => {
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

  it('lists appointments through Rust /api/v2 and adapts cursor envelopes for the current schedule UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'appointment-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-MAIN-2026-000001',
              patient_display_name: 'Ama Mensah',
              starts_at: '2026-05-12T09:00:00Z',
              ends_at: '2026-05-12T09:30:00Z',
              status: 'scheduled',
              created_at: '2026-05-11T08:00:00Z',
            },
          ],
          page: { limit: 10, has_next: true, next_cursor: 'cursor-2' },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await appointmentsApi.getAppointments({ page: 1, limit: 10 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/appointments?limit=10',
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
        {
          id: 'appointment-1',
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
          start: '2026-05-12T09:00:00Z',
          end: '2026-05-12T09:30:00Z',
          start_time: '2026-05-12T09:00:00Z',
          end_time: '2026-05-12T09:30:00Z',
          status: 'booked',
          v2_status: 'scheduled',
          appointment_type_name: 'General',
          appointment_type_details: {
            id: 'general',
            name: 'General',
            code: 'general',
            duration_minutes: 30,
            is_active: true,
          },
          comment: '',
          description: '',
          created_at: '2026-05-11T08:00:00Z',
        },
      ],
      page: 1,
      page_size: 10,
      count: 2,
      total: 2,
      count_exact: false,
      next: 'cursor-2',
      previous: null,
      next_cursor: 'cursor-2',
    });
  });

  it('loads an appointment detail through Rust /api/v2 and adapts it for the existing detail page', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'appointment-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            patient_display_name: 'Ama Mensah',
            starts_at: '2026-05-12T09:00:00Z',
            ends_at: '2026-05-12T09:30:00Z',
            status: 'checked_in',
            created_at: '2026-05-11T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await appointmentsApi.getAppointment('appointment-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/appointments/appointment-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toMatchObject({
      id: 'appointment-1',
      patient: 'patient-1',
      patient_name: 'Ama Mensah',
      start: '2026-05-12T09:00:00Z',
      end: '2026-05-12T09:30:00Z',
      status: 'arrived',
      v2_status: 'checked_in',
    });
  });

  it('creates appointments through the Rust contract while accepting the existing form payload shape', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'appointment-2',
            patient_id: 'patient-2',
            patient_code: 'MRN-MAIN-2026-000002',
            patient_display_name: 'Kojo Boateng',
            starts_at: '2026-05-12T10:00:00Z',
            ends_at: '2026-05-12T10:30:00Z',
            status: 'scheduled',
            created_at: '2026-05-11T08:30:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await appointmentsApi.createAppointment({
      patient: 'patient-2',
      start_time: '2026-05-12T10:00:00Z',
      end_time: '2026-05-12T10:30:00Z',
      practitioner: 'practitioner-1',
      appointment_type: 'general',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/appointments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          patient_id: 'patient-2',
          starts_at: '2026-05-12T10:00:00Z',
          ends_at: '2026-05-12T10:30:00Z',
        }),
      }),
    );
    expect(response).toMatchObject({
      id: 'appointment-2',
      patient_name: 'Kojo Boateng',
      status: 'booked',
    });
  });

  it('cancels appointments through the Rust cancel action instead of the old Django action', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'appointment-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            patient_display_name: 'Ama Mensah',
            starts_at: '2026-05-12T09:00:00Z',
            ends_at: '2026-05-12T09:30:00Z',
            status: 'cancelled',
            created_at: '2026-05-11T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await appointmentsApi.cancelAppointment('appointment-1', 'Patient unavailable');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/appointments/appointment-1/cancel',
      expect.objectContaining({
        method: 'POST',
        body: undefined,
      }),
    );
    expect(response).toMatchObject({
      id: 'appointment-1',
      status: 'cancelled',
    });
  });

  it('does not fall back to legacy schedule mappings when Rust V2 has no generated contract', async () => {
    await expect(
      appointmentsApi.getScheduleMappings({ clinic_id: 'clinic-1' }),
    ).resolves.toEqual([]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves AbortError from Rust appointment list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      appointmentsApi.getAppointments({ signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
