import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { laboratoryApi } from '../laboratory';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 laboratory bridge', () => {
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

  it('loads lab order worklists through generated Rust V2 endpoints', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'order-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              priority: 'urgent',
              status: 'ordered',
              ordered_at: '2026-05-12T08:00:00Z',
              test_count: 2,
            },
          ],
          page: { limit: 24, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await laboratoryApi.getLabOrders({
      status: 'ordered',
      expand: 'tests',
      page: 1,
      page_size: 24,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/laboratory/orders?limit=24&status=ordered',
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
      count: 1,
      page: 1,
      page_size: 24,
      total_pages: 1,
      results: [
        expect.objectContaining({
          id: 'order-1',
          patient: 'patient-1',
          patient_id: 'patient-1',
          patient_details: expect.objectContaining({
            medical_record_number: 'MRN-001',
          }),
          priority: 'urgent',
          status: 'ordered',
          tests_count: 2,
        }),
      ],
    });
  });

  it('loads unverified lab results through generated Rust V2 endpoints', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'result-1',
              order_id: 'order-1',
              specimen_id: 'specimen-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              test_id: 'test-1',
              test_name: 'Malaria RDT',
              value: 'negative',
              unit: null,
              status: 'entered',
              entered_at: '2026-05-12T09:00:00Z',
              verified_at: null,
            },
          ],
          page: { limit: 24, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await laboratoryApi.getLabResultsPaginated({
      is_verified: false,
      page: 1,
      page_size: 24,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/laboratory/results?limit=24&is_verified=false',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
      }),
    );
    expect(response.results).toEqual([
      expect.objectContaining({
        id: 'result-1',
        order: 'order-1',
        patient: 'patient-1',
        patient_details: expect.objectContaining({
          medical_record_number: 'MRN-001',
        }),
        test_details: expect.objectContaining({
          name: 'Malaria RDT',
        }),
        is_verified: false,
      }),
    ]);
  });
});
