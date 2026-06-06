import { beforeEach, describe, expect, it, vi } from 'vitest';

import { v2Api } from '@/lib/api/v2/client';
import { careAreasApi } from './index';

vi.mock('@/lib/api/v2/runtime', () => ({
  isRustV2ApiMode: () => true,
}));

vi.mock('@/lib/api/v2/client', () => ({
  v2Api: {
    getCareAreaMyWork: vi.fn(),
    postOutpatientIntake: vi.fn(),
    postInpatientIntake: vi.fn(),
    postEmergencyIntake: vi.fn(),
  },
}));

describe('careAreasApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and normalizes scoped My Work from Rust V2', async () => {
    const signal = new AbortController().signal;
    v2Api.getCareAreaMyWork.mockResolvedValueOnce({
      data: {
        generated_at: '2026-06-06T10:00:00Z',
        outpatient: {
          date: '2026-06-06',
          appointments: [{ id: 'appointment-1', patient_id: 'patient-1' }],
          has_more_appointments: false,
          active_visits: [],
          has_more_active_visits: false,
        },
        inpatient: {
          assigned_wards: [{ ward_id: 'ward-1', ward_name: 'Ward 1' }],
          primary_ward_id: 'ward-1',
          default_ward_id: 'ward-1',
          can_view_all_wards: false,
        },
        emergency: {
          assigned_triage: [{ id: 'triage-1', patient_id: 'patient-2' }],
          has_more_assigned_triage: false,
          waiting_triage: [],
          has_more_waiting_triage: false,
        },
        patient_context: {
          recent_patients: [{ id: 'patient-3' }],
          has_more_recent_patients: false,
        },
      },
    });

    const result = await careAreasApi.getMyWork({ signal });

    expect(v2Api.getCareAreaMyWork).toHaveBeenCalledWith({ signal });
    expect(result.outpatient.appointments).toHaveLength(1);
    expect(result.inpatient.assigned_wards[0].ward_id).toBe('ward-1');
    expect(result.emergency.assigned_triage[0].id).toBe('triage-1');
    expect(result.patient_context.recent_patients[0].id).toBe('patient-3');
  });

  it('starts outpatient intake through the Rust V2 generated client', async () => {
    const signal = new AbortController().signal;
    const payload = {
      patient_id: 'patient-1',
      clinic_id: 'clinic-1',
      idempotency_key: 'opd-key-1',
    };
    v2Api.postOutpatientIntake.mockResolvedValueOnce({
      data: {
        patient_id: 'patient-1',
        visit: { id: 'visit-1', status: 'waiting' },
      },
    });

    const result = await careAreasApi.startOutpatientIntake(payload, { signal });

    expect(v2Api.postOutpatientIntake).toHaveBeenCalledWith(payload, { signal });
    expect(result.visit.id).toBe('visit-1');
  });

  it('starts inpatient intake through the Rust V2 generated client', async () => {
    const signal = new AbortController().signal;
    const payload = {
      patient_id: 'patient-1',
      ward_id: 'ward-1',
      idempotency_key: 'ipd-key-1',
    };
    v2Api.postInpatientIntake.mockResolvedValueOnce({
      data: {
        patient_id: 'patient-1',
        admission_case: { id: 'case-1', status: 'ready_for_activation' },
      },
    });

    const result = await careAreasApi.startInpatientIntake(payload, { signal });

    expect(v2Api.postInpatientIntake).toHaveBeenCalledWith(payload, { signal });
    expect(result.admission_case.id).toBe('case-1');
  });

  it('starts emergency intake through the Rust V2 generated client', async () => {
    const signal = new AbortController().signal;
    const payload = {
      patient_id: 'patient-1',
      acuity: 'urgent',
      idempotency_key: 'ed-key-1',
    };
    v2Api.postEmergencyIntake.mockResolvedValueOnce({
      data: {
        patient_id: 'patient-1',
        visit: { id: 'visit-1', status: 'waiting' },
        triage: { id: 'triage-1', status: 'waiting' },
      },
    });

    const result = await careAreasApi.startEmergencyIntake(payload, { signal });

    expect(v2Api.postEmergencyIntake).toHaveBeenCalledWith(payload, { signal });
    expect(result.triage.id).toBe('triage-1');
  });
});
