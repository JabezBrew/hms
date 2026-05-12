import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inventoryApi } from '../inventory';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 inventory bridge', () => {
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

  it('builds dashboard metrics from Rust V2 inventory lists', async () => {
    const expiresSoon = dateDaysFromNow(10);
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'item-1',
              category_id: 'category-1',
              code: 'PARA500',
              name: 'Paracetamol 500mg',
              item_type: 'medication',
              unit: 'tablet',
              controlled: false,
            },
            {
              id: 'item-2',
              category_id: 'category-1',
              code: 'MOR10',
              name: 'Morphine 10mg ampoule',
              item_type: 'controlled_substance',
              unit: 'ampoule',
              controlled: true,
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'batch-1',
              item_id: 'item-1',
              item_name: 'Paracetamol 500mg',
              location_id: 'location-1',
              location_name: 'Main Pharmacy',
              batch_number: 'B001',
              expires_on: expiresSoon,
              quantity_on_hand: 24,
              received_at: '2026-05-12T08:00:00Z',
            },
            {
              id: 'batch-2',
              item_id: 'item-2',
              item_name: 'Morphine 10mg ampoule',
              location_id: 'location-1',
              location_name: 'Main Pharmacy',
              batch_number: 'B002',
              expires_on: null,
              quantity_on_hand: 0,
              received_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'req-1',
              requesting_location_id: 'location-1',
              requesting_location_name: 'Main Pharmacy',
              status: 'requested',
              created_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'grn-1',
              purchase_order_id: 'po-1',
              supplier_name: 'Medical Supplier',
              status: 'received',
              received_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      );

    const metrics = await inventoryApi.getDashboardMetrics();

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/inventory/items',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/inventory/stock-batches?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/inventory/requisitions?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/inventory/goods-received-notes?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(metrics).toMatchObject({
      total_items: 2,
      low_stock_count: 1,
      expiring_soon_count: 1,
      pending_requisitions: 1,
      pending_grns: 1,
      total_stock_value: 0,
    });
  });

  it('loads low-stock alerts from bounded Rust V2 stock batches', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'batch-1',
            item_id: 'item-1',
            item_name: 'Paracetamol 500mg',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            batch_number: 'B001',
            expires_on: null,
            quantity_on_hand: 0,
            received_at: '2026-05-12T08:00:00Z',
          },
          {
            id: 'batch-2',
            item_id: 'item-2',
            item_name: 'Morphine 10mg ampoule',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            batch_number: 'B002',
            expires_on: null,
            quantity_on_hand: 12,
            received_at: '2026-05-12T08:00:00Z',
          },
        ],
        page: { limit: 10, has_next: false, next_cursor: null },
        meta: {},
      }),
    );

    const alerts = await inventoryApi.getLowStockAlerts({ limit: 10 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/inventory/stock-batches?limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'item-1',
        name: 'Paracetamol 500mg',
        item_name: 'Paracetamol 500mg',
        sku: 'B001',
        stock_level: 0,
        total_stock: 0,
      }),
    ]);
  });

  it('loads expiring items from bounded Rust V2 stock batches', async () => {
    const expiresSoon = dateDaysFromNow(7);
    const expiresLater = dateDaysFromNow(45);
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'batch-1',
            item_id: 'item-1',
            item_name: 'Paracetamol 500mg',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            batch_number: 'B001',
            expires_on: expiresSoon,
            quantity_on_hand: 20,
            received_at: '2026-05-12T08:00:00Z',
          },
          {
            id: 'batch-2',
            item_id: 'item-2',
            item_name: 'Morphine 10mg ampoule',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            batch_number: 'B002',
            expires_on: expiresLater,
            quantity_on_hand: 20,
            received_at: '2026-05-12T08:00:00Z',
          },
        ],
        page: { limit: 10, has_next: false, next_cursor: null },
        meta: {},
      }),
    );

    const expiring = await inventoryApi.getExpiringItems({ days: 30, limit: 10 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/inventory/stock-batches?limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(expiring).toEqual([
      expect.objectContaining({
        id: 'item-1',
        item_name: 'Paracetamol 500mg',
        batch_number: 'B001',
        expiry_date: expiresSoon,
        days_until_expiry: expect.any(Number),
      }),
    ]);
  });

  it('preserves AbortError from Rust dashboard calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      inventoryApi.getDashboardMetrics({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('routes inventory list pages through generated Rust V2 endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'cat-1', name: 'Medication' }], meta: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'item-1', name: 'Paracetamol' }], meta: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'loc-1', name: 'Main Store' }], meta: {} }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'req-1', status: 'requested' }],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'po-1', supplier_name: 'Acme Medical' }],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'grn-1', status: 'received' }],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'internal-req-1', status: 'requested' }],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'transfer-1', status: 'requested' }],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ id: 'register-1', item_name: 'Morphine', balance_on_hand: 5 }],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }));

    await expect(inventoryApi.getCategories()).resolves.toEqual([
      expect.objectContaining({ id: 'cat-1' }),
    ]);
    await expect(inventoryApi.getInventoryItems({ page_size: 24 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'item-1' })],
    });
    await expect(inventoryApi.getStorageLocations({ page_size: 24 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'loc-1' })],
    });
    await expect(inventoryApi.getRequisitions({ page_size: 20 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'req-1' })],
    });
    await expect(inventoryApi.getPurchaseOrders({ page_size: 20 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'po-1' })],
    });
    await expect(inventoryApi.getGRNs({ page_size: 20 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'grn-1' })],
    });
    await expect(inventoryApi.getInternalRequisitions({ page_size: 20 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'internal-req-1' })],
    });
    await expect(inventoryApi.getTransferRequests({ page_size: 20 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'transfer-1' })],
    });
    await expect(inventoryApi.getControlledRegisters({ page_size: 20 })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'register-1' })],
    });

    expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:8080/api/v2/inventory/categories',
      'http://localhost:8080/api/v2/inventory/items',
      'http://localhost:8080/api/v2/inventory/storage-locations',
      'http://localhost:8080/api/v2/inventory/requisitions?limit=20',
      'http://localhost:8080/api/v2/inventory/purchase-orders?limit=20',
      'http://localhost:8080/api/v2/inventory/goods-received-notes?limit=20',
      'http://localhost:8080/api/v2/inventory/requisitions?limit=20',
      'http://localhost:8080/api/v2/inventory/transfers?limit=20',
      'http://localhost:8080/api/v2/pharmacy/controlled-substances/register?limit=20',
    ]);
  });

  it('returns safe local fallbacks for inventory screens without a Rust V2 contract', async () => {
    await expect(inventoryApi.getSuppliers()).resolves.toMatchObject({ results: [], count: 0 });
    await expect(inventoryApi.getStandingOrders()).resolves.toMatchObject({ results: [], count: 0 });
    await expect(inventoryApi.getConsumptionAnalytics()).resolves.toMatchObject({
      period: '30d',
      results: [],
      total_consumption: 0,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function dateDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
