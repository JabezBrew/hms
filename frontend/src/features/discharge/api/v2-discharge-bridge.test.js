import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dischargeApi } from './index';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 discharge bridge', () => {
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

  it('loads discharge cases through Rust /api/v2 and adapts queue fields', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'discharge-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              status: 'requested',
              requested_at: '2026-05-12T09:00:00Z',
              discharged_at: null,
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

    const cases = await dischargeApi.getCases({}, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/discharges?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal,
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(cases).toEqual([
      expect.objectContaining({
        id: 'discharge-1',
        admission: 'admission-1',
        patient: 'patient-1',
        patient_name: 'Ama Mensah',
        medical_record_number: 'MRN-001',
        status: 'awaiting_clearance',
        medical_ready_at: '2026-05-12T09:00:00Z',
        blockers: expect.arrayContaining([
          expect.objectContaining({ task_type: 'billing_clearance', status: 'pending' }),
          expect.objectContaining({ task_type: 'nursing_finalization', status: 'pending' }),
        ]),
        invoice_summary: expect.objectContaining({ patient_balance_due: '0.00' }),
      }),
    ]);
  });

  it('completes discharge cases through Rust /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'discharge-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            status: 'completed',
            requested_at: '2026-05-12T09:00:00Z',
            discharged_at: '2026-05-12T12:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await dischargeApi.finalizeCase('discharge-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/discharges/discharge-1/complete',
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'discharge-1',
        status: 'finalized',
        finalized_at: '2026-05-12T12:00:00Z',
        blockers: [],
      }),
    );
  });

  it('loads discharge case detail through the Rust /api/v2 detail endpoint', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'discharge-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            status: 'requested',
            requested_at: '2026-05-12T09:00:00Z',
            discharged_at: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await dischargeApi.getCase('discharge-1', { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/discharges/discharge-1',
      expect.objectContaining({ method: 'GET', credentials: 'include', signal }),
    );
    expect(result).toEqual(expect.objectContaining({
      id: 'discharge-1',
      admission: 'admission-1',
      patient_name: 'Ama Mensah',
      status: 'awaiting_clearance',
    }));
  });

  it('derives discharge task rows from Rust /api/v2 discharge blockers', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'discharge-1',
              admission_case_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              status: 'requested',
              requested_at: '2026-05-12T09:00:00Z',
              discharged_at: null,
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

    const tasks = await dischargeApi.getTasks({ admission: 'admission-1' }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/discharges?limit=25',
      expect.objectContaining({ method: 'GET', credentials: 'include', signal }),
    );
    expect(tasks).toEqual([
      expect.objectContaining({
        id: 'discharge-1:billing_clearance',
        discharge_case: 'discharge-1',
        admission_case: 'admission-1',
        patient: 'patient-1',
        patient_name: 'Ama Mensah',
        task_type: 'billing_clearance',
        status: 'pending',
      }),
      expect.objectContaining({
        id: 'discharge-1:nursing_finalization',
        discharge_case: 'discharge-1',
        admission_case: 'admission-1',
        task_type: 'nursing_finalization',
        status: 'pending',
      }),
    ]);
  });

  it('cancels a discharge case through Rust /api/v2 and preserves the reason body', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'discharge-1',
            admission_case_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            status: 'cancelled',
            requested_at: '2026-05-12T09:00:00Z',
            discharged_at: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const result = await dischargeApi.cancelCase(
      'discharge-1',
      'Patient discharge plan changed',
      { signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/discharges/discharge-1/cancel',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        signal,
        body: JSON.stringify({ reason: 'Patient discharge plan changed' }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({
      id: 'discharge-1',
      status: 'cancelled',
      blockers: [],
    }));
  });

  it('fails closed for discharge workflow operations Rust V2 does not expose', async () => {
    await expect(dischargeApi.clearBilling('discharge-1')).rejects.toThrow(
      'Rust V2 does not expose discharge billing clearance yet',
    );
    await expect(dischargeApi.completeTask('task-1')).rejects.toThrow(
      'Rust V2 does not expose discharge task operations yet',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
