import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { useDashboardActions } from '../useDashboardActions';

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn((config) => config),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('Rust V2 dashboard action bridge', () => {
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

  it('threads AbortSignal through supported Rust V2 dashboard actions', async () => {
    const signal = new AbortController().signal;
    const startsAt = '2026-05-12T09:00:00.000Z';
    const endsAt = '2026-05-12T09:30:00.000Z';
    const recordedAt = '2026-05-12T10:00:00.000Z';

    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'med-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          medication_name: 'Paracetamol',
          status: 'administered',
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
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'visit-1',
          patient_id: 'patient-1',
          appointment_id: 'appointment-1',
          clinic_id: 'clinic-1',
          status: 'waiting',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'alert-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          status: 'acknowledged',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'appointment-2',
          patient_id: 'patient-1',
          starts_at: startsAt,
          ends_at: endsAt,
          status: 'booked',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'vitals-1',
          admission_case_id: 'admission-1',
          patient_id: 'patient-1',
          recorded_at: recordedAt,
          temperature_c: 37.1,
        },
        meta: {},
      }));

    const actions = useDashboardActions();

    await expect(actions.administerMedication.mutationFn({
      medicationId: 'med-1',
      administrationData: { witness: 'user-2' },
      signal,
    })).resolves.toMatchObject({ id: 'med-1' });
    await expect(actions.completeTask.mutationFn({
      taskId: 'task-1',
      completionNotes: 'Done',
      signal,
    })).resolves.toMatchObject({ id: 'task-1' });
    await expect(actions.checkInPatient.mutationFn({
      appointmentId: 'appointment-1',
      patientId: 'patient-1',
      clinicId: 'clinic-1',
      signal,
    })).resolves.toMatchObject({ id: 'visit-1' });
    await expect(actions.acknowledgeAlert.mutationFn({
      alertId: 'alert-1',
      notes: 'Seen',
      signal,
    })).resolves.toMatchObject({ id: 'alert-1' });
    await expect(actions.scheduleAppointment.mutationFn({
      patient: 'patient-1',
      start_time: startsAt,
      end_time: endsAt,
      signal,
    })).resolves.toMatchObject({ id: 'appointment-2' });
    await expect(actions.recordVitals.mutationFn({
      patientId: 'patient-1',
      vitalsData: {
        admission_case_id: 'admission-1',
        recorded_at: recordedAt,
        temperature: 37.1,
      },
      signal,
    })).resolves.toMatchObject({ id: 'vitals-1' });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal])).toEqual([
      ['http://localhost:8080/api/v2/nursing/medication-administrations/med-1/administer', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/tasks/task-1/complete', 'POST', signal],
      ['http://localhost:8080/api/v2/visits/check-in', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/alerts/alert-1/acknowledge', 'POST', signal],
      ['http://localhost:8080/api/v2/appointments', 'POST', signal],
      ['http://localhost:8080/api/v2/nursing/vitals', 'POST', signal],
    ]);
  });

  it('preserves AbortError from Rust V2 dashboard actions', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(useDashboardActions().completeTask.mutationFn({
      taskId: 'task-1',
      signal: new AbortController().signal,
    })).rejects.toBe(abortError);
  });
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
