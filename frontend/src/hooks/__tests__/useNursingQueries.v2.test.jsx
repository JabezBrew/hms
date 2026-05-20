import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useActiveAlerts,
  useAcknowledgeAlert,
  useCompleteTask,
  useAdministerMedication,
  useBulkDispense,
  useBulkDispenseSupply,
  useCreateAndAdminister,
  useCreateMedicationAdministration,
  useCreateFluidBalance,
  useCreateNursingTask,
  useCreateShiftHandoff,
  useCreateTreatmentEntry,
  useCreateVitalSigns,
  useDeleteFluidBalance,
  useDiscontinueTreatmentEntry,
  useDispenseMedication,
  useDispenseSupply,
  useFluidBalance,
  useFluidBalanceAlerts,
  useFluidBalanceSettings,
  useFluidBalanceSummary,
  useFluidBalanceTrends,
  useGenerateMAR,
  useLowSupplyEntries,
  useMARGrid,
  useMedicationAdministrationHistory,
  useMedicationAdministrations,
  useMedicationsDueNow,
  useNursingAlerts,
  useNursingTasks,
  useOverdueMedications,
  usePatientDetail,
  usePatientMAR,
  usePatientMonitoring,
  usePendingDispensingGrouped,
  usePendingSupplyRequests,
  useRejectSupplyRequest,
  useRequestSupply,
  useShiftHandoffs,
  useSupplyRequest,
  useSupplyStatus,
  useTreatmentSheetByAdmission,
  useTreatmentSheetEntry,
  useTodayTasks,
  useUpdateTask,
  useTodayFluidBalance,
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

  it('loads patient monitoring detail from a patient-scoped Rust ward board query', async () => {
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
          page: { limit: 50, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => usePatientDetail('patient-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.patient_id).toBe('patient-1'));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/board?limit=1&patient_id=patient-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data).toEqual(expect.objectContaining({
      patient_name: 'Ama Mensah',
      patient_mrn: 'MRN-001',
      ward_name: 'General Ward',
      pending_tasks: expect.arrayContaining([expect.objectContaining({ status: 'open' })]),
    }));
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

  it('loads filtered nursing alerts from Rust V2 and adapts patient details', async () => {
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
            {
              id: 'alert-2',
              admission_case_id: 'admission-2',
              patient_id: 'patient-2',
              patient_code: 'MRN-002',
              patient_display_name: 'Kojo Mensah',
              severity: 'low',
              title: 'Routine review',
              status: 'acknowledged',
              created_at: '2026-05-12T10:00:00Z',
              acknowledged_at: '2026-05-12T10:10:00Z',
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
      () => useNursingAlerts({ patient: 'patient-1', severity: 'high', status: 'open' }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/alerts?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'alert-1',
        patient: 'patient-1',
        patient_mrn: 'MRN-001',
        patient_name: 'Ama Mensah',
        message: 'High fever watch',
        severity: 'high',
        acknowledged: false,
      }),
    ]);
  });

  it('acknowledges nursing alerts through the Rust V2 alert action', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'alert-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            severity: 'high',
            title: 'High fever watch',
            status: 'acknowledged',
            created_at: '2026-05-12T09:00:00Z',
            acknowledged_at: '2026-05-12T09:10:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useAcknowledgeAlert(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ alertId: 'alert-1', notes: 'Seen' });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/alerts/alert-1/acknowledge',
      expect.objectContaining({ method: 'POST' }),
    );
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
        task_type: 'observation',
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

  it('rejects unsupported legacy task types instead of silently remapping them', async () => {
    const { result } = renderHook(() => useCreateNursingTask(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync({
      admission_case_id: 'admission-1',
      task_type: 'wound_care',
      scheduled_time: '2026-05-12T11:00:00.000Z',
    })).rejects.toThrow('Rust V2 nursing task type must be one of');

    expect(globalThis.fetch).not.toHaveBeenCalled();
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

  it('cancels nursing tasks through the Rust V2 cancel action used by the task page', async () => {
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
            status: 'cancelled',
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

    const { result } = renderHook(() => useUpdateTask(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ taskId: 'task-1', status: 'cancelled' });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/tasks/task-1/cancel',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('loads medication administrations from Rust V2 and adapts medication fields for the UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'med-admin-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              medication_name: 'Paracetamol',
              scheduled_at: '2026-05-12T10:00:00Z',
              administered_at: null,
              status: 'scheduled',
            },
            {
              id: 'med-admin-2',
              admission_case_id: 'admission-2',
              patient_id: 'patient-2',
              patient_code: 'MRN-002',
              patient_display_name: 'Kojo Mensah',
              medication_name: 'Amoxicillin',
              scheduled_at: '2026-05-12T11:00:00Z',
              administered_at: '2026-05-12T11:05:00Z',
              status: 'administered',
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
      () => useMedicationAdministrations({ patient: 'patient-1', status: 'scheduled' }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/medication-administrations?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'med-admin-1',
        patient: 'patient-1',
        patient_mrn: 'MRN-001',
        patient_name: 'Ama Mensah',
        medication_name: 'Paracetamol',
        prescription_name: 'Paracetamol',
        scheduled_time: '2026-05-12T10:00:00Z',
      }),
    ]);
  });

  it('loads medication administration history from Rust V2 as a paginated shape', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'med-admin-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              medication_name: 'Paracetamol',
              scheduled_at: '2026-05-12T10:00:00Z',
              administered_at: null,
              status: 'scheduled',
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

    const { result } = renderHook(
      () => useMedicationAdministrationHistory({ patient: 'patient-1', page: 1, page_size: 20 }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data?.results).toHaveLength(1));

    expect(result.current.data).toEqual(expect.objectContaining({
      count: 1,
      page: 1,
      total_pages: 1,
      has_next: false,
      results: [expect.objectContaining({ id: 'med-admin-1', patient: 'patient-1' })],
    }));
  });

  it('loads due and overdue medication administrations from Rust V2 bounded pages', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const payload = {
      data: [
        {
          id: 'med-admin-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          patient_display_name: 'Ama Mensah',
          medication_name: 'Paracetamol',
          scheduled_at: past,
          administered_at: null,
          status: 'scheduled',
        },
        {
          id: 'med-admin-2',
          admission_case_id: 'admission-2',
          patient_id: 'patient-2',
          patient_code: 'MRN-002',
          patient_display_name: 'Kojo Mensah',
          medication_name: 'Amoxicillin',
          scheduled_at: future,
          administered_at: null,
          status: 'scheduled',
        },
      ],
      page: { limit: 50, has_next: false, next_cursor: null },
      meta: {},
    };
    globalThis.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const due = renderHook(() => useMedicationsDueNow(), {
      wrapper: createWrapper(),
    });
    const overdue = renderHook(() => useOverdueMedications(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(due.result.current.data).toHaveLength(1));
    await waitFor(() => expect(overdue.result.current.data).toHaveLength(1));

    expect(due.result.current.data[0]).toEqual(expect.objectContaining({ id: 'med-admin-1' }));
    expect(overdue.result.current.data[0]).toEqual(expect.objectContaining({ id: 'med-admin-1' }));
  });

  it('creates medication administrations through the Rust V2 schedule contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'med-admin-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            medication_name: 'Paracetamol',
            scheduled_at: '2026-05-12T10:00:00.000Z',
            administered_at: null,
            status: 'scheduled',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useCreateMedicationAdministration(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        admission_case_id: 'admission-1',
        medication_name: 'Paracetamol',
        scheduled_time: '2026-05-12T10:00:00.000Z',
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/medication-administrations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          admission_case_id: 'admission-1',
          medication_name: 'Paracetamol',
          scheduled_at: '2026-05-12T10:00:00.000Z',
        }),
      }),
    );
  });

  it('administers medication administrations through the Rust V2 administer action', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'med-admin-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            medication_name: 'Paracetamol',
            scheduled_at: '2026-05-12T10:00:00Z',
            administered_at: '2026-05-12T10:05:00Z',
            status: 'administered',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useAdministerMedication(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        medicationId: 'med-admin-1',
        data: { witness_user_id: 'witness-1' },
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/medication-administrations/med-admin-1/administer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ witness_user_id: 'witness-1' }),
      }),
    );
  });

  it('creates and administers medication administrations by composing Rust V2 schedule and administer actions', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'med-admin-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              medication_name: 'Paracetamol',
              scheduled_at: '2026-05-12T10:00:00.000Z',
              administered_at: null,
              status: 'scheduled',
            },
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
              id: 'med-admin-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              medication_name: 'Paracetamol',
              scheduled_at: '2026-05-12T10:00:00.000Z',
              administered_at: '2026-05-12T10:05:00Z',
              status: 'administered',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const { result } = renderHook(() => useCreateAndAdminister(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        admission_case_id: 'admission-1',
        medication_name: 'Paracetamol',
        scheduled_time: '2026-05-12T10:00:00.000Z',
        witness_user_id: 'witness-1',
      });
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/nursing/medication-administrations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/nursing/medication-administrations/med-admin-1/administer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ witness_user_id: 'witness-1' }),
      }),
    );
  });

  it('loads patient MAR from Rust V2 medication administrations', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'med-admin-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              medication_name: 'Paracetamol',
              scheduled_at: '2026-05-12T10:00:00Z',
              administered_at: null,
              status: 'scheduled',
            },
            {
              id: 'med-admin-2',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              medication_name: 'Amoxicillin',
              scheduled_at: '2026-05-12T12:00:00Z',
              administered_at: '2026-05-12T12:05:00Z',
              status: 'administered',
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

    const { result } = renderHook(() => usePatientMAR('patient-1', '2026-05-12'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.medications).toHaveLength(2));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/medication-administrations?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data).toEqual(expect.objectContaining({
      patient_id: 'patient-1',
      patient_name: 'Ama Mensah',
      patient_mrn: 'MRN-001',
      medications: [
        expect.objectContaining({
          id: 'med-admin-1',
          is_dispensed: true,
          scheduled_time: '2026-05-12T10:00:00Z',
        }),
        expect.objectContaining({
          id: 'med-admin-2',
          administered_time: '2026-05-12T12:05:00Z',
          status: 'administered',
        }),
      ],
    }));
  });

  it('derives the MAR grid from Rust V2 medication administrations without the legacy grid endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'med-admin-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              medication_name: 'Paracetamol',
              scheduled_at: '2026-05-12T10:00:00Z',
              administered_at: null,
              status: 'scheduled',
            },
            {
              id: 'med-admin-2',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              medication_name: 'Paracetamol',
              scheduled_at: '2026-05-13T10:00:00Z',
              administered_at: '2026-05-13T10:05:00Z',
              status: 'administered',
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

    const { result } = renderHook(() => useMARGrid('admission-1', '2026-05-12', 2), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.medications).toHaveLength(1));

    expect(result.current.data).toEqual(expect.objectContaining({
      patient_name: 'Ama Mensah',
      patient_mrn: 'MRN-001',
      date_headers: [
        expect.objectContaining({ date: '2026-05-12' }),
        expect.objectContaining({ date: '2026-05-13' }),
      ],
      medications: [
        expect.objectContaining({
          medication_name: 'Paracetamol',
          total_doses_required: 2,
          total_doses_administered: 1,
          days: expect.objectContaining({
            '2026-05-12': expect.objectContaining({
              doses: [expect.objectContaining({ id: 'med-admin-1', dose_number: 1 })],
            }),
            '2026-05-13': expect.objectContaining({
              doses_given: 1,
              doses: [expect.objectContaining({ id: 'med-admin-2', status: 'administered' })],
            }),
          }),
        }),
      ],
    }));
  });

  it('fails closed for MAR generation and pharmacy dispensing mutations that Rust V2 does not expose', async () => {
    const generate = renderHook(() => useGenerateMAR(), {
      wrapper: createWrapper(),
    });
    const dispense = renderHook(() => useDispenseMedication(), {
      wrapper: createWrapper(),
    });
    const bulkDispense = renderHook(() => useBulkDispense(), {
      wrapper: createWrapper(),
    });

    await expect(generate.result.current.mutateAsync({ prescriptionId: 'rx-1' })).rejects.toThrow(
      'Rust V2 does not expose MAR generation yet.',
    );
    await expect(dispense.result.current.mutateAsync('med-admin-1')).rejects.toThrow(
      'Rust V2 does not expose pharmacy dispense actions from the nursing queue yet.',
    );
    await expect(bulkDispense.result.current.mutateAsync(['med-admin-1'])).rejects.toThrow(
      'Rust V2 does not expose pharmacy bulk dispense actions from the nursing queue yet.',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('loads and creates treatment-sheet shells through the Rust V2 treatment sheet contract', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'sheet-1',
                admission_case_id: 'admission-1',
                patient_id: 'patient-1',
                patient_code: 'MRN-001',
                patient_display_name: 'Ama Mensah',
                sheet_date: '2026-05-12',
                status: 'active',
                updated_at: '2026-05-12T09:00:00Z',
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
              id: 'sheet-2',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              sheet_date: '2026-05-13',
              status: 'active',
              updated_at: '2026-05-13T09:00:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const list = renderHook(() => useTreatmentSheetByAdmission('admission-1'), {
      wrapper: createWrapper(),
    });
    const create = renderHook(() => useCreateTreatmentEntry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    await act(async () => {
      await create.result.current.mutateAsync({
        admission: 'admission-1',
        date: '2026-05-13',
      });
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/nursing/treatment-sheets?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/nursing/treatment-sheets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          admission_case_id: 'admission-1',
          sheet_date: '2026-05-13',
        }),
      }),
    );
    expect(list.result.current.data[0]).toEqual(expect.objectContaining({
      id: 'sheet-1',
      admission: 'admission-1',
      patient: 'patient-1',
      patient_name: 'Ama Mensah',
    }));
  });

  it('uses bounded Rust V2 treatment-sheet lookup and local empty states for unsupported supply status surfaces', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'sheet-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              sheet_date: '2026-05-12',
              status: 'active',
              updated_at: '2026-05-12T09:00:00Z',
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

    const entry = renderHook(() => useTreatmentSheetEntry('sheet-1'), {
      wrapper: createWrapper(),
    });
    const lowSupply = renderHook(() => useLowSupplyEntries(), {
      wrapper: createWrapper(),
    });
    const supplyStatus = renderHook(() => useSupplyStatus('sheet-1'), {
      wrapper: createWrapper(),
    });
    const discontinue = renderHook(() => useDiscontinueTreatmentEntry(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(entry.result.current.data?.id).toBe('sheet-1'));
    await waitFor(() => expect(lowSupply.result.current.data).toEqual([]));
    await waitFor(() => expect(supplyStatus.result.current.data?.supported).toBe(false));
    await expect(discontinue.result.current.mutateAsync({ entryId: 'sheet-1', reason: 'done' })).rejects.toThrow(
      'Rust V2 does not expose treatment-sheet discontinuation yet.',
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('loads, creates, and fulfills ward stock requests through the Rust V2 ward stock request contract', async () => {
    const listPayload = {
      data: [
        {
          id: 'stock-1',
          ward_id: 'ward-1',
          ward_name: 'General Ward',
          requested_item: 'Gauze',
          quantity_requested: 4,
          status: 'requested',
          requested_at: '2026-05-12T09:00:00Z',
          approved_at: null,
          fulfilled_at: null,
        },
      ],
      page: { limit: 50, has_next: false, next_cursor: null },
      meta: {},
    };
    globalThis.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify(listPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          id: 'stock-2',
          ward_id: 'ward-1',
          ward_name: 'General Ward',
          requested_item: 'Syringe',
          quantity_requested: 10,
          status: 'requested',
          requested_at: '2026-05-12T10:00:00Z',
          approved_at: null,
          fulfilled_at: null,
        },
        meta: {},
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          id: 'stock-1',
          ward_id: 'ward-1',
          ward_name: 'General Ward',
          requested_item: 'Gauze',
          quantity_requested: 4,
          status: 'fulfilled',
          requested_at: '2026-05-12T09:00:00Z',
          approved_at: null,
          fulfilled_at: '2026-05-12T11:00:00Z',
        },
        meta: {},
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const pending = renderHook(() => usePendingSupplyRequests(), {
      wrapper: createWrapper(),
    });
    const requestSupply = renderHook(() => useRequestSupply(), {
      wrapper: createWrapper(),
    });
    const dispenseSupply = renderHook(() => useDispenseSupply(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(pending.result.current.data).toHaveLength(1));
    await act(async () => {
      await requestSupply.result.current.mutateAsync({
        ward_id: 'ward-1',
        requested_item: 'Syringe',
        quantity: 10,
      });
    });
    await act(async () => {
      await dispenseSupply.result.current.mutateAsync({ requestId: 'stock-1' });
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/nursing/ward-stock-requests?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/nursing/ward-stock-requests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ward_id: 'ward-1',
          requested_item: 'Syringe',
          quantity_requested: 10,
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nursing/ward-stock-requests/stock-1/fulfill',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(pending.result.current.data[0]).toEqual(expect.objectContaining({
      id: 'stock-1',
      status: 'pending',
      requested_item: 'Gauze',
      quantity_requested: 4,
    }));
  });

  it('uses bounded Rust V2 ward stock lookup and fails closed for unsupported stock rejection', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          {
            id: 'stock-1',
            ward_id: 'ward-1',
            ward_name: 'General Ward',
            requested_item: 'Gauze',
            quantity_requested: 4,
            status: 'requested',
            requested_at: '2026-05-12T09:00:00Z',
            approved_at: null,
            fulfilled_at: null,
          },
        ],
        page: { limit: 50, has_next: false, next_cursor: null },
        meta: {},
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          id: 'stock-1',
          ward_id: 'ward-1',
          ward_name: 'General Ward',
          requested_item: 'Gauze',
          quantity_requested: 4,
          status: 'fulfilled',
          requested_at: '2026-05-12T09:00:00Z',
          approved_at: null,
          fulfilled_at: '2026-05-12T11:00:00Z',
        },
        meta: {},
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const request = renderHook(() => useSupplyRequest('stock-1'), {
      wrapper: createWrapper(),
    });
    const bulkDispense = renderHook(() => useBulkDispenseSupply(), {
      wrapper: createWrapper(),
    });
    const reject = renderHook(() => useRejectSupplyRequest(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(request.result.current.data?.id).toBe('stock-1'));
    await act(async () => {
      const result = await bulkDispense.result.current.mutateAsync(['stock-1']);
      expect(result).toEqual(expect.objectContaining({ dispensed_count: 1 }));
    });
    await expect(reject.result.current.mutateAsync({ requestId: 'stock-1', reason: 'no stock' })).rejects.toThrow(
      'Rust V2 does not expose ward stock request rejection yet.',
    );
  });

  it('loads fluid balance entries from Rust V2 and expands intake/output records for the UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'fluid-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              recorded_at: '2026-05-12T08:00:00Z',
              intake_ml: 500,
              output_ml: 0,
              net_ml: 500,
            },
            {
              id: 'fluid-2',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              recorded_at: '2026-05-12T09:00:00Z',
              intake_ml: 0,
              output_ml: 200,
              net_ml: -200,
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
      () => useFluidBalance('patient-1', { date: '2026-05-12' }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/fluid-balance?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: 'fluid-1:intake',
        source_id: 'fluid-1',
        patient: 'patient-1',
        entry_type: 'intake',
        volume_ml: 500,
        recorded_at: '2026-05-12T08:00:00Z',
      }),
      expect.objectContaining({
        id: 'fluid-2:output',
        source_id: 'fluid-2',
        entry_type: 'output',
        volume_ml: 200,
      }),
    ]);
  });

  it('derives fluid balance summaries and trends from Rust V2 bounded entries', async () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const payload = {
      data: [
        {
          id: 'fluid-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          patient_display_name: 'Ama Mensah',
          recorded_at: `${todayKey}T08:00:00Z`,
          intake_ml: 500,
          output_ml: 0,
          net_ml: 500,
        },
        {
          id: 'fluid-2',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          patient_display_name: 'Ama Mensah',
          recorded_at: `${todayKey}T09:00:00Z`,
          intake_ml: 0,
          output_ml: 200,
          net_ml: -200,
        },
      ],
      page: { limit: 50, has_next: false, next_cursor: null },
      meta: {},
    };
    globalThis.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    const summary = renderHook(() => useFluidBalanceSummary('patient-1', todayKey), {
      wrapper: createWrapper(),
    });
    const today = renderHook(() => useTodayFluidBalance('patient-1'), {
      wrapper: createWrapper(),
    });
    const trends = renderHook(
      () => useFluidBalanceTrends('patient-1', { start_date: todayKey, end_date: todayKey }),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => expect(summary.result.current.data?.total_intake).toBe(500));
    await waitFor(() => expect(today.result.current.data?.total_output).toBe(200));
    await waitFor(() => expect(trends.result.current.data).toHaveLength(1));

    expect(summary.result.current.data).toEqual(expect.objectContaining({
      total_intake: 500,
      total_output: 200,
      balance: 300,
    }));
    expect(trends.result.current.data[0]).toEqual(expect.objectContaining({
      date: todayKey,
      intake: 500,
      output: 200,
      balance: 300,
    }));
  });

  it('creates fluid balance entries through the Rust V2 fluid balance contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'fluid-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            recorded_at: '2026-05-12T08:00:00.000Z',
            intake_ml: 500,
            output_ml: 0,
            net_ml: 500,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useCreateFluidBalance(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        admission: 'admission-1',
        entry_type: 'intake',
        volume_ml: 500,
        recorded_at: '2026-05-12T08:00:00.000Z',
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/nursing/fluid-balance',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          admission_case_id: 'admission-1',
          recorded_at: '2026-05-12T08:00:00.000Z',
          intake_ml: 500,
          output_ml: 0,
        }),
      }),
    );
  });

  it('fails closed for fluid balance deletion because Rust V2 has no delete contract', async () => {
    const { result } = renderHook(() => useDeleteFluidBalance(), {
      wrapper: createWrapper(),
    });

    await expect(result.current.mutateAsync('fluid-1')).rejects.toThrow(
      'Rust V2 does not expose fluid balance deletion yet.',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('uses local fluid balance settings defaults in Rust V2 mode', async () => {
    const { result } = renderHook(() => useFluidBalanceSettings(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.min_daily_intake_target).toBe(1500));

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(expect.objectContaining({
      max_daily_output_threshold: 3000,
      negative_balance_alert_threshold: -500,
      positive_balance_alert_threshold: 2000,
    }));
  });

  it('derives fluid balance alerts from Rust V2 entries and local thresholds', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'fluid-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              recorded_at: '2026-05-12T08:00:00Z',
              intake_ml: 100,
              output_ml: 0,
              net_ml: 100,
            },
            {
              id: 'fluid-2',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              recorded_at: '2026-05-12T09:00:00Z',
              intake_ml: 0,
              output_ml: 900,
              net_ml: -900,
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

    const { result } = renderHook(() => useFluidBalanceAlerts('patient-1', '2026-05-12'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.alerts?.length).toBeGreaterThan(0));

    expect(result.current.data).toEqual(expect.objectContaining({
      alerts: expect.arrayContaining([expect.objectContaining({ type: 'negative_balance' })]),
      summary: expect.objectContaining({ total_intake: 100, total_output: 900, balance: -800 }),
    }));
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
