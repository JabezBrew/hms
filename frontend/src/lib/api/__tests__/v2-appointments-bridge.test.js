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

    const response = await appointmentsApi.getAppointments({
      page: 1,
      limit: 10,
      date: '2026-05-12',
      clinic_id: 'clinic-1',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/appointments?limit=10&date=2026-05-12&clinic_id=clinic-1',
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
      current_page: 1,
      requested_page: 1,
      resolved_page: 1,
      cursor_missing: false,
      page_size: 10,
      count: 2,
      total: 2,
      total_pages: 2,
      count_exact: false,
      next: 'cursor-2',
      previous: null,
      next_cursor: 'cursor-2',
    });
  });

  it('searches appointments through the private Rust V2 search endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [],
          page: { limit: 10, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await appointmentsApi.getAppointments({
      limit: 10,
      date: '2026-05-12',
      search: 'Ama',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/appointments/search',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ limit: 10, date: '2026-05-12', search: 'Ama' }),
      }),
    );
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
            appointment: {
              id: 'appointment-2',
              patient_id: 'patient-2',
              patient_code: 'MRN-MAIN-2026-000002',
              patient_display_name: 'Kojo Boateng',
              starts_at: '2026-05-12T10:00:00Z',
              ends_at: '2026-05-12T10:30:00Z',
              status: 'scheduled',
              clinic_session_id: 'session-1',
              appointment_type_id: 'type-review',
              practitioner_user_id: 'practitioner-1',
              appointment_type_name: 'Review',
              clinic_id: 'clinic-1',
              created_at: '2026-05-11T08:30:00Z',
            },
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
      appointment_type: 'type-review',
      clinic_session: 'session-1',
      clinic: 'clinic-1',
      overbook_reason: 'Consultant approved urgent review',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/scheduling/appointments/book',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, requestOptions] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(requestOptions.body)).toEqual({
      patient_id: 'patient-2',
      starts_at: '2026-05-12T10:00:00Z',
      ends_at: '2026-05-12T10:30:00Z',
      clinic_id: 'clinic-1',
      session_id: 'session-1',
      service_id: 'type-review',
      practitioner_user_id: 'practitioner-1',
      overbook_reason: 'Consultant approved urgent review',
    });
    expect(response).toMatchObject({
      id: 'appointment-2',
      patient_name: 'Kojo Boateng',
      status: 'booked',
      clinic_id: 'clinic-1',
      clinic_session_id: 'session-1',
      appointment_type_id: 'type-review',
      practitioner: 'practitioner-1',
      appointment_type_name: 'Review',
    });
  });

  it('threads AbortSignal through Rust appointment mutation calls', async () => {
    const signal = new AbortController().signal;
    const scheduledAppointment = {
      id: 'appointment-1',
      patient_id: 'patient-1',
      patient_code: 'MRN-MAIN-2026-000001',
      patient_display_name: 'Ama Mensah',
      starts_at: '2026-05-12T09:00:00Z',
      ends_at: '2026-05-12T09:30:00Z',
      status: 'scheduled',
      created_at: '2026-05-11T08:00:00Z',
    };

    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: { appointment: scheduledAppointment },
          meta: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: scheduledAppointment, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: { ...scheduledAppointment, status: 'cancelled' },
          meta: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: scheduledAppointment, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          data: {
            id: 'visit-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            patient_display_name: 'Ama Mensah',
            appointment_id: 'appointment-1',
            clinic_id: null,
            status: 'waiting',
            checked_in_at: '2026-05-12T08:55:00Z',
          },
          meta: {},
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    await appointmentsApi.createAppointment({
      patient: 'patient-1',
      start_time: '2026-05-12T09:00:00Z',
      end_time: '2026-05-12T09:30:00Z',
      signal,
    });
    await appointmentsApi.updateAppointment('appointment-1', {
      start_time: '2026-05-12T09:30:00Z',
      end_time: '2026-05-12T10:00:00Z',
      signal,
    });
    await appointmentsApi.cancelAppointment('appointment-1', 'Patient unavailable', { signal });
    await appointmentsApi.checkInAppointment('appointment-1', { signal });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/scheduling/appointments/book',
      expect.objectContaining({ method: 'POST', signal }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/appointments/appointment-1',
      expect.objectContaining({ method: 'PATCH', signal }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/appointments/appointment-1/cancel',
      expect.objectContaining({ method: 'POST', signal }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/scheduling/appointments/appointment-1/arrive',
      expect.objectContaining({ method: 'POST', signal }),
    );
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
        body: JSON.stringify({ reason: 'Patient unavailable' }),
      }),
    );
    expect(response).toMatchObject({
      id: 'appointment-1',
      status: 'cancelled',
    });
  });

  it('requires a cancellation reason before calling the Rust cancel action', async () => {
    await expect(appointmentsApi.cancelAppointment('appointment-1', '  '))
      .rejects
      .toThrow('Cancellation reason is required');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('checks in appointments through the Rust scheduling arrival contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'visit-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            patient_display_name: 'Ama Mensah',
            appointment_id: 'appointment-1',
            clinic_id: null,
            status: 'waiting',
            checked_in_at: '2026-05-12T08:55:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await appointmentsApi.checkInAppointment('appointment-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/scheduling/appointments/appointment-1/arrive',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          clinic_id: null,
        }),
      }),
    );
    expect(response).toMatchObject({
      id: 'visit-1',
      visit_id: 'visit-1',
      appointment: 'appointment-1',
      patient: 'patient-1',
      visit_status: 'waiting',
    });
  });

  it('maps arrived status updates to the Rust scheduling arrival contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'visit-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-MAIN-2026-000001',
            patient_display_name: 'Ama Mensah',
            appointment_id: 'appointment-1',
            clinic_id: null,
            status: 'waiting',
            checked_in_at: '2026-05-12T08:55:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await appointmentsApi.updateAppointmentStatus('appointment-1', 'arrived');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/scheduling/appointments/appointment-1/arrive',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          clinic_id: null,
        }),
      }),
    );
    expect(response).toMatchObject({
      id: 'visit-1',
      appointment: 'appointment-1',
      patient: 'patient-1',
      visit_status: 'waiting',
    });
  });

  it('does not fall back to legacy schedule mappings when Rust V2 has no generated contract', async () => {
    await expect(
      appointmentsApi.getScheduleMappings({ clinic_id: 'clinic-1' }),
    ).resolves.toEqual([]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('loads Rust V2 availability from the scheduling contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            slots: [
              {
                id: 'session-1:2026-05-16T08:00:00Z',
                session_id: 'session-1',
                session_name: 'General OPD',
                clinic_id: 'clinic-1',
                start: '2026-05-16T08:00:00Z',
                end: '2026-05-16T12:00:00Z',
                status: 'free',
                capacity: { max: 20, booked: 4, remaining: 16, overbook_remaining: 0 },
              },
            ],
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const slots = await appointmentsApi.getAvailableSlots({
      clinic_id: 'clinic-1',
      appointment_type_id: 'type-general',
      start_date: '2026-05-01',
      end_date: '2026-05-31',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/scheduling/availability?start_date=2026-05-01&limit=100&end_date=2026-05-31&clinic_id=clinic-1&service_id=type-general',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      session_id: 'session-1',
      status: 'free',
      capacity: { remaining: 16 },
    });
  });

  it('preserves AbortError from Rust appointment list calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      appointmentsApi.getAppointments({ signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
