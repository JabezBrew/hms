import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import {
  useAcknowledgeAlert,
  useAdministerMedication,
  useBulkDispenseSupply,
  useCompleteTask,
  useCreateAndAdminister,
  useCreateFluidBalance,
  useCreateMedicationAdministration,
  useCreateNursingTask,
  useCreateShiftHandoff,
  useCreateTreatmentEntry,
  useCreateVitalSigns,
  useDispenseSupply,
  useRequestSupply,
  useUpdateShiftHandoff,
  useUpdateTask,
} from '../useNursingQueries';

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((config) => config),
  useQuery: vi.fn((config) => config),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

describe('Rust V2 nursing mutation bridge', () => {
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

  it('threads AbortSignal through supported Rust V2 nursing mutations', async () => {
    const signal = new AbortController().signal;
    const recordedAt = '2026-05-12T08:00:00.000Z';
    const dueAt = '2026-05-12T09:00:00.000Z';
    const scheduledAt = '2026-05-12T10:00:00.000Z';

    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'vitals-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          recorded_at: recordedAt,
          temperature_c: 37.2,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'task-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          task_type: 'observation',
          status: 'open',
          due_at: dueAt,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'task-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          task_type: 'observation',
          status: 'completed',
          due_at: dueAt,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'task-2',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          task_type: 'observation',
          status: 'cancelled',
          due_at: dueAt,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'alert-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          title: 'Fall risk',
          status: 'acknowledged',
          acknowledged_at: '2026-05-12T08:05:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'med-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          medication_name: 'Paracetamol',
          scheduled_at: scheduledAt,
          status: 'scheduled',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'med-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          medication_name: 'Paracetamol',
          scheduled_at: scheduledAt,
          administered_at: '2026-05-12T10:05:00Z',
          status: 'administered',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'med-2',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          medication_name: 'Ibuprofen',
          scheduled_at: scheduledAt,
          status: 'scheduled',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'med-2',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          medication_name: 'Ibuprofen',
          scheduled_at: scheduledAt,
          administered_at: '2026-05-12T10:10:00Z',
          status: 'administered',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'handoff-1',
          ward_id: 'ward-1',
          from_user_id: 'user-1',
          to_user_id: 'user-2',
          shift_label: 'day',
          status: 'open',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'handoff-1',
          ward_id: 'ward-1',
          from_user_id: 'user-1',
          to_user_id: 'user-2',
          shift_label: 'day',
          status: 'completed',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'sheet-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          sheet_date: '2026-05-12',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'stock-1',
          ward_id: 'ward-1',
          requested_item: 'Gauze',
          quantity_requested: 2,
          status: 'requested',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'stock-1',
          ward_id: 'ward-1',
          requested_item: 'Gauze',
          quantity_requested: 2,
          status: 'fulfilled',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'stock-2',
          ward_id: 'ward-1',
          requested_item: 'Syringe',
          quantity_requested: 1,
          status: 'fulfilled',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'stock-3',
          ward_id: 'ward-1',
          requested_item: 'Gloves',
          quantity_requested: 1,
          status: 'fulfilled',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'fluid-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          recorded_at: recordedAt,
          intake_ml: 250,
          output_ml: 0,
          net_ml: 250,
        },
        meta: {},
      }));

    await expect(useCreateVitalSigns().mutationFn({
      admission_case_id: 'admission-1',
      recorded_at: recordedAt,
      temperature: 37.2,
      signal,
    })).resolves.toMatchObject({ id: 'vitals-1', temperature: 37.2 });
    await expect(useCreateNursingTask().mutationFn({
      admission_case_id: 'admission-1',
      task_type: 'observation',
      due_at: dueAt,
      signal,
    })).resolves.toMatchObject({ id: 'task-1', status: 'pending' });
    await expect(useCompleteTask().mutationFn({
      taskId: 'task-1',
      data: {},
      signal,
    })).resolves.toMatchObject({ id: 'task-1', status: 'completed' });
    await expect(useUpdateTask().mutationFn({
      taskId: 'task-2',
      data: { status: 'cancelled' },
      signal,
    })).resolves.toMatchObject({ id: 'task-2', status: 'cancelled' });
    await expect(useAcknowledgeAlert().mutationFn({
      alertId: 'alert-1',
      notes: 'Seen',
      signal,
    })).resolves.toMatchObject({ id: 'alert-1', acknowledged: true });
    await expect(useCreateMedicationAdministration().mutationFn({
      admission_case_id: 'admission-1',
      medication_name: 'Paracetamol',
      scheduled_at: scheduledAt,
      signal,
    })).resolves.toMatchObject({ id: 'med-1', status: 'scheduled' });
    await expect(useAdministerMedication().mutationFn({
      medicationId: 'med-1',
      data: { witness: 'user-2' },
      signal,
    })).resolves.toMatchObject({ id: 'med-1', status: 'administered' });
    await expect(useCreateAndAdminister().mutationFn({
      admission_case_id: 'admission-1',
      medication_name: 'Ibuprofen',
      scheduled_at: scheduledAt,
      witness: 'user-2',
      signal,
    })).resolves.toMatchObject({ id: 'med-2', status: 'administered' });
    await expect(useCreateShiftHandoff().mutationFn({
      ward_id: 'ward-1',
      to_user_id: 'user-2',
      shift_label: 'day',
      signal,
    })).resolves.toMatchObject({ id: 'handoff-1', ward: 'ward-1' });
    await expect(useUpdateShiftHandoff().mutationFn({
      handoffId: 'handoff-1',
      data: { complete: true },
      signal,
    })).resolves.toMatchObject({ id: 'handoff-1', ward: 'ward-1' });
    await expect(useCreateTreatmentEntry().mutationFn({
      admission_case_id: 'admission-1',
      sheet_date: '2026-05-12',
      signal,
    })).resolves.toMatchObject({ id: 'sheet-1', admission: 'admission-1' });
    await expect(useRequestSupply().mutationFn({
      ward_id: 'ward-1',
      requested_item: 'Gauze',
      quantity: 2,
      signal,
    })).resolves.toMatchObject({ id: 'stock-1', status: 'pending' });
    await expect(useDispenseSupply().mutationFn({
      requestId: 'stock-1',
      quantityDispensed: 2,
      signal,
    })).resolves.toMatchObject({ id: 'stock-1', status: 'fulfilled' });
    await expect(useBulkDispenseSupply().mutationFn({
      requestIds: ['stock-2', 'stock-3'],
      signal,
    })).resolves.toMatchObject({ dispensed_count: 2 });
    await expect(useCreateFluidBalance().mutationFn({
      admission_case_id: 'admission-1',
      recorded_at: recordedAt,
      entry_type: 'intake',
      volume_ml: 250,
      signal,
    })).resolves.toMatchObject({ id: 'fluid-1:intake', patient: 'patient-1' });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal])).toEqual([
      ['http://localhost:8080/api/v2/nursing/vitals', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/tasks', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/tasks/task-1/complete', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/tasks/task-2/cancel', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/alerts/alert-1/acknowledge', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/medication-administrations', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/medication-administrations/med-1/administer', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/medication-administrations', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/medication-administrations/med-2/administer', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/handoffs', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/handoffs/handoff-1/complete', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/treatment-sheets', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/ward-stock-requests', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/ward-stock-requests/stock-1/fulfill', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/ward-stock-requests/stock-2/fulfill', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/ward-stock-requests/stock-3/fulfill', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/fluid-balance', 'POST', signal],
    ]);
  });
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
