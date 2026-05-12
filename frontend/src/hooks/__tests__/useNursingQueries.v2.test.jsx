import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveAlerts, usePatientMonitoring } from '../useNursingQueries';
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
});
