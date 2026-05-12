import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useActiveAlerts,
  useCompleteTask,
  useCreateNursingTask,
  useCreateShiftHandoff,
  useCreateVitalSigns,
  useNursingTasks,
  usePatientMonitoring,
  usePendingDispensingGrouped,
  useShiftHandoffs,
  useTodayTasks,
  useVitalSigns,
  useVitalSignsTrends,
} from '../useNursingQueries';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('Rust V2 nursing dashboard hooks', () => {
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

  it('loads patient monitoring rows from the Rust ward board endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              admission_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              ward_id: 'ward-1',
              ward_name: 'General Ward',
              bed_id: 'bed-1',
              bed_code: 'G-01',
              admission_status: 'admitted',
              admitted_at: '2026-05-12T08:00:00Z',
              open_nursing_task_count: 2,
              due_medication_count: 1,
            },
          ],
          page: { limit: 20, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => usePatientMonitoring('ward-1', 1, 20), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.count).toBe(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/board?limit=20&ward_id=ward-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(result.current.data).toEqual({
      count: 1,
      page: 1,
      page_size: 20,
      total_pages: 1,
      results: [
        expect.objectContaining({
          patient: expect.objectContaining({
            id: 'patient-1',
            medical_record_number: 'MRN-001',
            user: expect.objectContaining({ full_name: 'Ama Mensah' }),
          }),
          patient_id: 'patient-1',
          ward_id: 'ward-1',
          admission: expect.objectContaining({
            id: 'admission-1',
            bed_details: expect.objectContaining({
              bed_number: 'G-01',
              ward_details: expect.objectContaining({ name: 'General Ward' }),
            }),
          }),
          pending_tasks: expect.arrayContaining([expect.objectContaining({ status: 'open' })]),
          medications_due: expect.arrayContaining([expect.objectContaining({ status: 'scheduled' })]),
        }),
      ],
    });
  });

  it('loads active alerts from Rust nursing alerts and adapts patient details', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'alert-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              severity: 'high',
              title: 'High fever watch',
              status: 'open',
              created_at: '2026-05-12T09:00:00Z',
              acknowledged_at: null,
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

    const { result } = renderHook(() => useActiveAlerts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/alerts?limit=50',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'alert-1',
        alert_type: 'nursing_alert',
        message: 'High fever watch',
        severity: 'high',
        patient_details: expect.objectContaining({
          medical_record_number: 'MRN-001',
          user_details: expect.objectContaining({ full_name: 'Ama Mensah' }),
        }),
      }),
    ]);
  });

  it('loads nursing tasks from Rust V2 and adapts open tasks for the current UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'task-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              task_type: 'observation',
              status: 'open',
              due_at: '2026-05-12T11:00:00Z',
            },
            {
              id: 'task-2',
              admission_case_id: 'admission-2',
              patient_id: 'patient-2',
              patient_code: 'MRN-002',
              patient_display_name: 'Kojo Mensah',
              task_type: 'medication',
              status: 'completed',
              due_at: '2026-05-12T12:00:00Z',
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

    const { result } = renderHook(
      () => useNursingTasks({ patient: 'patient-1', status: 'pending' }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/tasks?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'task-1',
        patient: 'patient-1',
        patient_id: 'patient-1',
        patient_mrn: 'MRN-001',
        patient_name: 'Ama Mensah',
        admission: 'admission-1',
        task_type: 'observation',
        status: 'pending',
        scheduled_time: '2026-05-12T11:00:00Z',
      }),
    ]);
  });

  it('loads today nursing tasks from Rust V2 using a bounded page', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'task-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              task_type: 'observation',
              status: 'open',
              due_at: `${today}T11:00:00Z`,
            },
            {
              id: 'task-2',
              admission_case_id: 'admission-2',
              patient_id: 'patient-2',
              patient_code: 'MRN-002',
              patient_display_name: 'Kojo Mensah',
              task_type: 'medication',
              status: 'open',
              due_at: `${tomorrow}T12:00:00Z`,
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

    const { result } = renderHook(() => useTodayTasks(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/tasks?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data[0]).toEqual(expect.objectContaining({ id: 'task-1' }));
  });

  it('creates nursing tasks through the Rust V2 task contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'task-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            task_type: 'observation',
            status: 'open',
            due_at: '2026-05-12T11:00:00.000Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useCreateNursingTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        admission_case_id: 'admission-1',
        task_type: 'assessment',
        scheduled_time: '2026-05-12T11:00:00.000Z',
        assigned_to: 'user-1',
        description: 'Check post-op observations',
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/tasks',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          admission_case_id: 'admission-1',
          task_type: 'observation',
          due_at: '2026-05-12T11:00:00.000Z',
          assigned_to_user_id: 'user-1',
        }),
      }),
    );
  });

  it('completes nursing tasks through the Rust V2 complete action', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'task-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            task_type: 'observation',
            status: 'completed',
            due_at: '2026-05-12T11:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useCompleteTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ taskId: 'task-1', data: { completion_notes: 'Done' } });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/tasks/task-1/complete',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('loads the pharmacy dispensing surface from Rust V2 without exposing dispensed records as pending work', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'dispense-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              item_id: 'item-1',
              item_name: 'Paracetamol 500mg',
              location_id: 'location-1',
              quantity: 10,
              status: 'dispensed',
              dispensed_at: '2026-05-12T09:00:00Z',
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

    const { result } = renderHook(() => usePendingDispensingGrouped(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual([]));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/pharmacy/dispenses?limit=50',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
  });

  it('loads patient vital signs from the Rust patient-filtered vitals endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'vitals-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              recorded_at: '2026-05-12T09:00:00Z',
              temperature_c: 37.5,
              systolic_bp: 120,
              diastolic_bp: 80,
              pulse: 88,
              respiratory_rate: 18,
              oxygen_saturation: 98,
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

    const { result } = renderHook(
      () => useVitalSigns({ patient: 'patient-1', hours: 48, ordering: '-recorded_at', limit: 25 }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/vitals?limit=25&patient_id=patient-1&hours=48',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'vitals-1',
        patient: 'patient-1',
        temperature: 37.5,
        heart_rate: 88,
        spo2: 98,
        systolic_bp: 120,
        diastolic_bp: 80,
      }),
    ]);
  });

  it('records patient vital signs through the Rust vitals endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'vitals-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            recorded_at: '2026-05-12T09:00:00Z',
            temperature_c: 37.5,
            systolic_bp: 120,
            diastolic_bp: 80,
            pulse: 88,
            respiratory_rate: 18,
            oxygen_saturation: 98,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useCreateVitalSigns(), {
      wrapper: createWrapper(),
    });

    let created;
    await act(async () => {
      created = await result.current.mutateAsync({
        patient: 'patient-1',
        admission_case_id: 'admission-1',
        temperature: 37.5,
        heart_rate: 88,
        blood_pressure_systolic: 120,
        blood_pressure_diastolic: 80,
        respiratory_rate: 18,
        oxygen_saturation: 98,
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/vitals',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: expect.any(String),
      }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      admission_case_id: 'admission-1',
      recorded_at: expect.any(String),
      temperature_c: 37.5,
      systolic_bp: 120,
      diastolic_bp: 80,
      pulse: 88,
      respiratory_rate: 18,
      oxygen_saturation: 98,
    });
    expect(created).toEqual(expect.objectContaining({
      patient: 'patient-1',
      heart_rate: 88,
      spo2: 98,
    }));
  });

  it('loads vital sign trends from the Rust vitals endpoint with patient and admission scope', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'vitals-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              recorded_at: '2026-05-12T09:00:00Z',
              temperature_c: 37.5,
              systolic_bp: 120,
              diastolic_bp: 80,
              pulse: 88,
              respiratory_rate: 18,
              oxygen_saturation: 98,
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

    const { result } = renderHook(
      () => useVitalSignsTrends('patient-1', { days: 7, admission_id: 'admission-1' }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/vitals?limit=50&patient_id=patient-1&admission_case_id=admission-1&hours=168',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'vitals-1',
        admission: 'admission-1',
        patient: 'patient-1',
        temperature: 37.5,
      }),
    ]);
  });

  it('loads shift handoffs from Rust V2 and filters the bounded page for the current ward UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'handoff-1',
              ward_id: 'ward-1',
              ward_name: 'General Ward',
              from_user_id: 'user-1',
              to_user_id: 'user-2',
              shift_label: 'night',
              status: 'draft',
              created_at: '2026-05-12T08:00:00Z',
            },
            {
              id: 'handoff-2',
              ward_id: 'ward-2',
              ward_name: 'Maternity Ward',
              from_user_id: 'user-3',
              to_user_id: 'user-4',
              shift_label: 'day',
              status: 'completed',
              created_at: '2026-05-12T09:00:00Z',
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

    const { result } = renderHook(
      () => useShiftHandoffs({ ward: 'ward-1', shift: 'night' }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/handoffs?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'handoff-1',
        ward: 'ward-1',
        ward_id: 'ward-1',
        shift_type: 'night',
        to_nurse: 'user-2',
      }),
    ]);
  });

  it('creates shift handoffs through the Rust V2 handoff contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'handoff-1',
            ward_id: 'ward-1',
            ward_name: 'General Ward',
            from_user_id: 'user-1',
            to_user_id: 'user-2',
            shift_label: 'night',
            status: 'draft',
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

    const { result } = renderHook(() => useCreateShiftHandoff(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        ward_id: 'ward-1',
        to_nurse: 'user-2',
        shift_type: 'night',
        patient_condition: 'Stable',
        pending_tasks: 'Continue monitoring',
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/handoffs',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ward_id: 'ward-1',
          to_user_id: 'user-2',
          shift_label: 'night',
        }),
      }),
    );
  });
});
