import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardActions } from '../useDashboardActions';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function v2Object(data = {}) {
  return new Response(
    JSON.stringify({ data, meta: {} }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('Rust V2 dashboard actions bridge', () => {
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
    vi.clearAllMocks();
  });

  it('routes supported dashboard mutations through Rust V2 endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(v2Object({ id: 'task-1', status: 'completed' }))
      .mockResolvedValueOnce(v2Object({ id: 'alert-1', status: 'acknowledged' }))
      .mockResolvedValueOnce(v2Object({ id: 'med-admin-1', status: 'administered' }))
      .mockResolvedValueOnce(v2Object({ id: 'visit-1', status: 'checked_in' }))
      .mockResolvedValueOnce(v2Object({ id: 'appointment-1', status: 'scheduled' }))
      .mockResolvedValueOnce(v2Object({ id: 'vitals-1', patient_id: 'patient-1' }));

    const { result } = renderHook(() => useDashboardActions(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.completeTask.mutateAsync({
        taskId: 'task-1',
        completionNotes: 'Done',
      });
      await result.current.acknowledgeAlert.mutateAsync({
        alertId: 'alert-1',
        notes: 'Seen',
      });
      await result.current.administerMedication.mutateAsync({
        medicationId: 'med-admin-1',
        administrationData: { witness_user_id: 'witness-1' },
      });
      await result.current.checkInPatient.mutateAsync({
        patientId: 'patient-1',
        appointmentId: 'appointment-1',
      });
      await result.current.scheduleAppointment.mutateAsync({
        patient: 'patient-1',
        start_time: '2026-05-12T09:00:00Z',
        end_time: '2026-05-12T09:30:00Z',
      });
      await result.current.recordVitals.mutateAsync({
        patientId: 'patient-1',
        vitalsData: {
          admission_case_id: 'admission-1',
          recorded_at: '2026-05-12T09:05:00Z',
          temperature: 37.2,
          heart_rate: 82,
          blood_pressure_systolic: 120,
          blood_pressure_diastolic: 75,
          spo2: 98,
        },
      });
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/nursing/tasks/task-1/complete',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/nursing/alerts/alert-1/acknowledge',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nursing/medication-administrations/med-admin-1/administer',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[2][1].body)).toEqual({
      witness_user_id: 'witness-1',
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/visits/check-in',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[3][1].body)).toEqual({
      patient_id: 'patient-1',
      appointment_id: 'appointment-1',
      clinic_id: null,
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'http://localhost:8080/api/v2/appointments',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[4][1].body)).toEqual({
      patient_id: 'patient-1',
      starts_at: '2026-05-12T09:00:00Z',
      ends_at: '2026-05-12T09:30:00Z',
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      6,
      'http://localhost:8080/api/v2/nursing/vitals',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[5][1].body)).toEqual({
      admission_case_id: 'admission-1',
      recorded_at: '2026-05-12T09:05:00Z',
      temperature_c: 37.2,
      systolic_bp: 120,
      diastolic_bp: 75,
      pulse: 82,
      respiratory_rate: null,
      oxygen_saturation: 98,
    });
  });

  it('fails closed instead of falling back to Django for unsupported Rust V2 dashboard actions', async () => {
    const { result } = renderHook(() => useDashboardActions(), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.updateBedStatus.mutateAsync({
        bedId: 'bed-1',
        status: 'maintenance',
        notes: 'Broken rail',
      }),
    ).rejects.toThrow('Bed status updates are not available in Rust V2');

    await expect(
      result.current.checkInPatient.mutateAsync({
        appointmentId: 'appointment-1',
      }),
    ).rejects.toThrow('Patient id is required to check in a patient in Rust V2');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
