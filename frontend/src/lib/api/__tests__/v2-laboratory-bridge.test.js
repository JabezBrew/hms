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

  it('loads catalog tests and panels through generated Rust V2 endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'test-1',
                code: 'MAL-RDT',
                name: 'Malaria RDT',
                specimen_type: 'blood',
                is_active: true,
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'panel-1',
                code: 'ANC',
                name: 'Antenatal panel',
                test_count: 3,
                is_active: true,
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

    const tests = await laboratoryApi.getLabTests({ page: 1, page_size: 24 });
    const panels = await laboratoryApi.getLabPanels({ page: 1, page_size: 24 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/laboratory/test-catalog',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/laboratory/panels',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(tests.results).toEqual([
      expect.objectContaining({
        id: 'test-1',
        name: 'Malaria RDT',
        specimen_type: 'blood',
      }),
    ]);
    expect(panels.results).toEqual([
      expect.objectContaining({
        id: 'panel-1',
        name: 'Antenatal panel',
      }),
    ]);
  });

  it('loads laboratory detail workflows through generated Rust V2 endpoints with abort signals', async () => {
    const controller = new AbortController();

    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'test-1',
          code: 'MAL-RDT',
          name: 'Malaria RDT',
          specimen_type: 'blood',
          result_unit: null,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'panel-1',
          code: 'ANC',
          name: 'Antenatal panel',
          test_count: 3,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'order-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          priority: 'urgent',
          status: 'ordered',
          ordered_at: '2026-05-12T08:00:00Z',
          test_count: 2,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'specimen-1',
          order_id: 'order-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          specimen_type: 'blood',
          status: 'collected',
          collected_at: '2026-05-12T08:10:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
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
        meta: {},
      }));

    await expect(laboratoryApi.getLabTest('test-1', { signal: controller.signal })).resolves.toMatchObject({
      id: 'test-1',
      name: 'Malaria RDT',
    });
    await expect(laboratoryApi.getLabPanel('panel-1', { signal: controller.signal })).resolves.toMatchObject({
      id: 'panel-1',
      name: 'Antenatal panel',
    });
    await expect(laboratoryApi.getLabOrder('order-1', { signal: controller.signal })).resolves.toMatchObject({
      id: 'order-1',
      patient: 'patient-1',
      tests_count: 2,
    });
    await expect(laboratoryApi.getLabSpecimen('specimen-1', { signal: controller.signal })).resolves.toMatchObject({
      id: 'specimen-1',
      order: 'order-1',
    });
    await expect(laboratoryApi.getLabResult('result-1', { signal: controller.signal })).resolves.toMatchObject({
      id: 'result-1',
      specimen: 'specimen-1',
      is_verified: false,
    });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal])).toEqual([
      ['http://localhost:8080/api/v2/laboratory/test-catalog/test-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/laboratory/panels/panel-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/laboratory/orders/order-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/laboratory/specimens/specimen-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/laboratory/results/result-1', 'GET', controller.signal],
    ]);
  });

  it('routes laboratory write workflows through generated Rust V2 endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'order-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          priority: 'urgent',
          status: 'ordered',
          ordered_at: '2026-05-12T08:00:00Z',
          test_count: 1,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: 'specimen-1',
          order_id: 'order-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          specimen_type: 'blood',
          status: 'collected',
          collected_at: '2026-05-12T08:10:00Z',
        }],
        page: { limit: 25, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'specimen-2',
          order_id: 'order-1',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          specimen_type: 'urine',
          status: 'collected',
          collected_at: '2026-05-12T08:20:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'result-1',
          order_id: 'order-1',
          specimen_id: 'specimen-2',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          test_id: 'test-1',
          test_name: 'Malaria RDT',
          value: 'negative',
          unit: null,
          status: 'entered',
          entered_at: '2026-05-12T08:30:00Z',
          verified_at: null,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'result-1',
          order_id: 'order-1',
          specimen_id: 'specimen-2',
          patient_id: 'patient-1',
          patient_code: 'MRN-001',
          test_id: 'test-1',
          test_name: 'Malaria RDT',
          value: 'negative',
          unit: null,
          status: 'verified',
          entered_at: '2026-05-12T08:30:00Z',
          verified_at: '2026-05-12T08:40:00Z',
        },
        meta: {},
      }));

    await expect(laboratoryApi.createLabOrder({
      patient: 'patient-1',
      tests: ['test-1'],
      priority: 'urgent',
    })).resolves.toMatchObject({ id: 'order-1', patient: 'patient-1' });
    await expect(laboratoryApi.getLabSpecimens({ page_size: 25 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'specimen-1', order: 'order-1' })],
    });
    await expect(laboratoryApi.createLabSpecimen({
      order: 'order-1',
      specimen_type: 'urine',
    })).resolves.toMatchObject({ id: 'specimen-2', order: 'order-1' });
    await expect(laboratoryApi.createLabResult({
      specimen: 'specimen-2',
      test: 'test-1',
      value: 'negative',
    })).resolves.toMatchObject({ id: 'result-1', specimen: 'specimen-2' });
    await expect(laboratoryApi.verifyLabResult('result-1')).resolves.toMatchObject({
      id: 'result-1',
      is_verified: true,
    });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      [
        'http://localhost:8080/api/v2/laboratory/orders',
        'POST',
        JSON.stringify({
          patient_id: 'patient-1',
          test_ids: ['test-1'],
          panel_ids: [],
          priority: 'urgent',
        }),
      ],
      [
        'http://localhost:8080/api/v2/laboratory/specimens?limit=25',
        'GET',
        undefined,
      ],
      [
        'http://localhost:8080/api/v2/laboratory/specimens',
        'POST',
        JSON.stringify({
          order_id: 'order-1',
          specimen_type: 'urine',
        }),
      ],
      [
        'http://localhost:8080/api/v2/laboratory/results',
        'POST',
        JSON.stringify({
          specimen_id: 'specimen-2',
          test_id: 'test-1',
          value: 'negative',
          unit: null,
        }),
      ],
      [
        'http://localhost:8080/api/v2/laboratory/results/result-1/verify',
        'POST',
        undefined,
      ],
    ]);
  });

  it('fails closed for laboratory actions without generated Rust V2 contracts', async () => {
    await expect(laboratoryApi.submitLabOrder('order-1')).rejects.toThrow('/api/v2 laboratory order status contract');
    await expect(laboratoryApi.collectLabOrder('order-1')).rejects.toThrow('/api/v2 laboratory order status contract');
    await expect(laboratoryApi.bulkCreateResults({ results: [] })).rejects.toThrow('/api/v2 laboratory bulk result contract');
    await expect(laboratoryApi.createLabTest({ name: 'Custom test' })).rejects.toThrow('/api/v2 laboratory catalog mutation contract');
    await expect(laboratoryApi.updateLabPanel('panel-1', { name: 'Panel' })).rejects.toThrow('/api/v2 laboratory panel mutation contract');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
