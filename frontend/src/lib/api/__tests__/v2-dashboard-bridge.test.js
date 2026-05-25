import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dashboardsApi } from '../dashboards';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 dashboard bridge', () => {
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

  function mockSnapshot() {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'snapshot-1',
            deployment_profile: 'hospital',
            generated_at: '2026-05-12T03:26:23Z',
            metrics: [
              {
                key: 'active_patients',
                label: 'Active Patients',
                value: 12,
                feature: 'patients',
                permission: 'patient.demographics.view',
              },
              {
                key: 'waiting_visits',
                label: 'Waiting Visits',
                value: 3,
                feature: 'appointments',
                permission: 'appointment.view',
              },
              {
                key: 'open_invoices',
                label: 'Open Invoices',
                value: 2,
                feature: 'billing',
                permission: 'billing.view',
              },
            ],
            navigation: { groups: [] },
          },
          meta: {
            generated_at: '2026-05-12T03:26:23Z',
            is_stale: false,
            refresh_queued: false,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
  }

  it('adapts the Rust dashboard snapshot for the admin v2 dashboard surface', async () => {
    mockSnapshot();

    const response = await dashboardsApi.getAdminDashboardV2({ window: 'today' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/dashboards/snapshot',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toMatchObject({
      kpis: {
        active_patients: { count: 12 },
        appointment_throughput: { scheduled: 3 },
        billing: { open_invoices: 2 },
      },
      section_summaries: {
        capacity: { status: 'normal' },
        workforce: { status: 'normal' },
        compliance: { status: 'normal' },
      },
      alerts_top: [],
      action_queue_top: [],
      meta: {
        generated_at: '2026-05-12T03:26:23Z',
        stale: false,
        refresh_queued: false,
      },
    });
  });

  it('adapts the Rust dashboard snapshot for the background critical-alert monitor', async () => {
    mockSnapshot();

    const response = await dashboardsApi.getAdminDashboard();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/dashboards/snapshot',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual({
      urgent: {
        critical_alerts: [],
        overdue_medications: [],
      },
    });
  });

  it('keeps null projection freshness timestamps when the Rust snapshot is a queued miss', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: '00000000-0000-0000-0000-000000000000',
            deployment_profile: 'hospital',
            generated_at: '1970-01-01T00:00:00Z',
            metrics: [],
            navigation: { groups: [] },
          },
          meta: {
            generated_at: null,
            is_stale: true,
            refresh_queued: true,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await dashboardsApi.getAdminDashboardV2({ window: 'today' });

    expect(response.meta).toMatchObject({
      generated_at: null,
      stale: true,
      refresh_queued: true,
    });
  });

  it('adapts the Rust dashboard snapshot for the my-work dashboard surface', async () => {
    mockSnapshot();

    const response = await dashboardsApi.getMyWorkDashboard({ date: '2026-05-12' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/dashboards/snapshot',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual(expect.objectContaining({
      date: '2026-05-12',
      current_patient: null,
      upcoming: [],
      completed: [],
      metrics: expect.arrayContaining([expect.objectContaining({ key: 'waiting_visits', value: 3 })]),
    }));
  });

  it('loads clinic schedule data from a date-filtered Rust appointment list', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'appointment-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              starts_at: '2026-05-12T09:00:00Z',
              ends_at: '2026-05-12T09:30:00Z',
              status: 'scheduled',
              created_at: '2026-05-11T09:00:00Z',
            },
            {
              id: 'appointment-2',
              patient_id: 'patient-2',
              patient_code: 'MRN-002',
              patient_display_name: 'Kojo Mensah',
              starts_at: '2026-05-12T10:00:00Z',
              ends_at: '2026-05-12T10:30:00Z',
              status: 'completed',
              created_at: '2026-05-11T10:00:00Z',
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

    const response = await dashboardsApi.getClinicSchedule({ date: '2026-05-12' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/appointments?date=2026-05-12&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual(expect.objectContaining({
      date: '2026-05-12',
      appointments: [
        expect.objectContaining({
          id: 'appointment-1',
          patient_id: 'patient-1',
          patient_name: 'Ama Mensah',
          start_time: '2026-05-12T09:00:00Z',
        }),
        expect.objectContaining({
          id: 'appointment-2',
          status: 'completed',
        }),
      ],
      upcoming: [expect.objectContaining({ id: 'appointment-1' })],
      completed: [expect.objectContaining({ id: 'appointment-2' })],
    }));
  });

  it('loads admin capacity details from the Rust capacity summary endpoint', async () => {
    const abortController = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            summary: {
              ward_count: 2,
              high_occupancy_wards: 1,
            },
            wait_time: {
              median_minutes: 0,
              p95_minutes: 0,
            },
            wards: [
              {
                ward_id: 'ward-1',
                ward_name: 'Surgical Ward',
                total_beds: 10,
                occupied_beds: 9,
                available_beds: 1,
                occupancy_pct: 90,
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

    const response = await dashboardsApi.getAdminDashboardV2Capacity(
      { window: 'today' },
      { signal: abortController.signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/dashboards/admin-v2/capacity?limit=8',
      expect.objectContaining({
        method: 'GET',
        signal: abortController.signal,
      }),
    );
    expect(response).toEqual(expect.objectContaining({
      summary: {
        ward_count: 2,
        high_occupancy_wards: 1,
      },
      wards: [
        expect.objectContaining({
          ward_id: 'ward-1',
          occupancy_pct: 90,
        }),
      ],
    }));
  });

  it('builds the nurse dashboard from bounded Rust ward, alert, medication, and task lists', async () => {
    const abortController = new AbortController();
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                admission_id: 'admission-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-001',
                patient_display_name: 'Ama Mensah',
                ward_id: 'ward-1',
                ward_name: 'Medical Ward',
                bed_code: 'B-12',
                admitted_at: '2026-05-12T07:00:00Z',
                open_nursing_task_count: 2,
                due_medication_count: 1,
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'alert-1',
                patient_id: 'patient-1',
                patient_display_name: 'Ama Mensah',
                severity: 'critical',
                title: 'Fall risk',
                status: 'open',
                created_at: '2026-05-12T08:00:00Z',
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'med-1',
                patient_id: 'patient-1',
                patient_display_name: 'Ama Mensah',
                medication_name: 'Paracetamol',
                scheduled_at: '2026-05-12T09:00:00Z',
                status: 'pending',
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'task-1',
                patient_id: 'patient-1',
                patient_display_name: 'Ama Mensah',
                task_type: 'vitals',
                status: 'pending',
                due_at: '2026-05-12T10:00:00Z',
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const response = await dashboardsApi.getNurseDashboard({
      ward: 'ward-1',
      signal: abortController.signal,
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/wards/board?ward_id=ward-1&limit=20',
      expect.objectContaining({ method: 'GET', signal: abortController.signal }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/nursing/alerts?limit=20',
      expect.objectContaining({ method: 'GET', signal: abortController.signal }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nursing/medication-administrations?limit=20',
      expect.objectContaining({ method: 'GET', signal: abortController.signal }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/nursing/tasks?limit=20',
      expect.objectContaining({ method: 'GET', signal: abortController.signal }),
    );
    expect(response).toEqual(expect.objectContaining({
      shift_patients: [
        expect.objectContaining({
          patient_id: 'patient-1',
          patient_name: 'Ama Mensah',
          mrn: 'MRN-001',
          ward_name: 'Medical Ward',
          bed_number: 'B-12',
          tasks_count: 2,
        }),
      ],
      urgent: expect.objectContaining({
        critical_alerts: [
          expect.objectContaining({
            id: 'alert-1',
            patient_name: 'Ama Mensah',
            message: 'Fall risk',
          }),
        ],
      }),
      medications_schedule: [expect.objectContaining({ id: 'med-1', scheduled_time: '2026-05-12T09:00:00Z' })],
      tasks: [expect.objectContaining({ id: 'task-1', title: 'Vitals' })],
    }));
  });

  it('builds the inpatient dashboard from bounded Rust ward, discharge, and task lists', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                admission_id: 'admission-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-001',
                patient_display_name: 'Ama Mensah',
                ward_id: 'ward-1',
                ward_name: 'Medical Ward',
                bed_code: 'B-12',
                admitted_at: '2026-05-12T07:00:00Z',
                open_nursing_task_count: 2,
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'discharge-1',
                admission_case_id: 'admission-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-001',
                patient_display_name: 'Ama Mensah',
                status: 'planned',
                requested_at: '2026-05-12T08:00:00Z',
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'task-1',
                patient_id: 'patient-1',
                patient_display_name: 'Ama Mensah',
                task_type: 'care_plan_review',
                status: 'pending',
                due_at: '2026-05-12T10:00:00Z',
              },
            ],
            page: { limit: 20, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const response = await dashboardsApi.getInpatientDashboard({ signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/wards/board?limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/discharges?limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nursing/tasks?limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual(expect.objectContaining({
      new_admissions: [expect.objectContaining({ id: 'admission-1', patient_name: 'Ama Mensah' })],
      my_patients: [expect.objectContaining({ id: 'admission-1', patient_id: 'patient-1' })],
      planned_discharges: [expect.objectContaining({ id: 'discharge-1', patient_name: 'Ama Mensah' })],
      pending: {
        results_to_review: 0,
        orders_to_sign: 1,
      },
    }));
  });

  it('builds the receptionist dashboard from bounded Rust appointments, patients, and billing summary', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'appointment-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-001',
                patient_display_name: 'Ama Mensah',
                practitioner_display_name: 'Dr Mensah',
                starts_at: '2026-05-12T09:00:00Z',
                ends_at: '2026-05-12T09:30:00Z',
                status: 'scheduled',
              },
              {
                id: 'appointment-2',
                patient_id: 'patient-2',
                patient_code: 'MRN-002',
                patient_display_name: 'Kojo Mensah',
                practitioner_display_name: 'Dr Mensah',
                starts_at: '2026-05-12T10:00:00Z',
                ends_at: '2026-05-12T10:30:00Z',
                status: 'checked_in',
              },
            ],
            page: { limit: 50, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'patient-1',
                patient_code: 'MRN-001',
                display_name: 'Ama Mensah',
                status: 'active',
                created_at: '2026-05-12T06:00:00Z',
              },
            ],
            page: { limit: 10, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              open_invoices: 4,
            },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    const response = await dashboardsApi.getReceptionistDashboard({ date: '2026-05-12' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/appointments?date=2026-05-12&limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/patients?limit=10&status=active',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/billing/dashboard-summary',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual(expect.objectContaining({
      check_in_queue: [expect.objectContaining({ id: 'appointment-1', patient_name: 'Ama Mensah' })],
      recent_registrations: [expect.objectContaining({ id: 'patient-1', full_name: 'Ama Mensah' })],
      todays_appointments: [
        expect.objectContaining({ id: 'appointment-1' }),
        expect.objectContaining({ id: 'appointment-2' }),
      ],
      stats: {
        todays_appointments_count: 2,
        checked_in_count: 1,
        pending_payments_count: 4,
      },
    }));
  });

  it('preserves AbortError from Rust V2 dashboard reads', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValue(abortError);

    await expect(dashboardsApi.getNurseDashboard({ signal: new AbortController().signal })).rejects.toBe(abortError);
    await expect(dashboardsApi.getInpatientDashboard({ signal: new AbortController().signal })).rejects.toBe(abortError);
    await expect(dashboardsApi.getReceptionistDashboard({ signal: new AbortController().signal })).rejects.toBe(abortError);
    await expect(dashboardsApi.getAdminDashboard({ signal: new AbortController().signal })).rejects.toBe(abortError);
    await expect(dashboardsApi.getMyWorkDashboard({ signal: new AbortController().signal })).rejects.toBe(abortError);
    await expect(dashboardsApi.getClinicSchedule({ signal: new AbortController().signal })).rejects.toBe(abortError);
    await expect(
      dashboardsApi.getAdminDashboardV2({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
    await expect(
      dashboardsApi.getAdminDashboardV2Capacity({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
