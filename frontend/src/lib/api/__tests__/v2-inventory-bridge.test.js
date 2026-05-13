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

  it('builds dashboard metrics from the Rust V2 inventory dashboard summary endpoint', async () => {
    const abortController = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          total_items: 2,
          low_stock_count: 1,
          expiring_soon_count: 1,
          expiring_count: 1,
          total_stock_value_minor: 0,
          total_value_minor: 0,
          pending_requisitions: 1,
          pending_grns: 1,
          discrepancies: 0,
        },
        meta: {},
      }),
    );

    const metrics = await inventoryApi.getDashboardMetrics(
      { days: 14 },
      { signal: abortController.signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/inventory/dashboard-summary?expiring_within_days=14',
      expect.objectContaining({
        method: 'GET',
        signal: abortController.signal,
      }),
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

  it('loads expired and expiring stock batches through Rust V2 server filters', async () => {
    const controller = new AbortController();
    const expiredDate = dateDaysFromNow(-1);
    const expiresSoon = dateDaysFromNow(7);
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'batch-expired',
            item_id: 'item-1',
            item_name: 'Paracetamol 500mg',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            batch_number: 'EXP-001',
            expires_on: expiredDate,
            quantity_on_hand: 20,
            received_at: '2026-05-12T08:00:00Z',
          },
        ],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'batch-soon',
            item_id: 'item-2',
            item_name: 'Amoxicillin 250mg',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            batch_number: 'SOON-001',
            expires_on: expiresSoon,
            quantity_on_hand: 12,
            received_at: '2026-05-12T08:00:00Z',
          },
        ],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'batch-soon',
            item_id: 'item-2',
            item_name: 'Amoxicillin 250mg',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            batch_number: 'SOON-001',
            expires_on: expiresSoon,
            quantity_on_hand: 12,
            received_at: '2026-05-12T08:00:00Z',
          },
        ],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }));

    await expect(inventoryApi.getExpiredBatches({ signal: controller.signal })).resolves.toEqual([
      expect.objectContaining({ batch_id: 'batch-expired', batch_number: 'EXP-001' }),
    ]);
    await expect(inventoryApi.getExpiringSoonBatches(30, { signal: controller.signal })).resolves.toEqual([
      expect.objectContaining({ batch_id: 'batch-soon', batch_number: 'SOON-001' }),
    ]);
    await expect(inventoryApi.getExpiryForecast({ days: 30, signal: controller.signal })).resolves.toMatchObject({
      days: 30,
      results: [expect.objectContaining({ batch_id: 'batch-soon', batch_number: 'SOON-001' })],
    });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal])).toEqual([
      [
        'http://localhost:8080/api/v2/inventory/stock-batches?expired=true&limit=20',
        'GET',
        controller.signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/stock-batches?expiring_within_days=30&limit=20',
        'GET',
        controller.signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/stock-batches?expiring_within_days=30&limit=20',
        'GET',
        controller.signal,
      ],
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
        data: [{ id: 'supplier-1', code: 'ACME', name: 'Acme Medical' }],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
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
    await expect(inventoryApi.getSuppliers({ page_size: 20, search: 'acme' })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'supplier-1', name: 'Acme Medical' })],
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
      'http://localhost:8080/api/v2/inventory/items?limit=24',
      'http://localhost:8080/api/v2/inventory/storage-locations?limit=24',
      'http://localhost:8080/api/v2/inventory/suppliers?search=acme&limit=20',
      'http://localhost:8080/api/v2/inventory/requisitions?limit=20',
      'http://localhost:8080/api/v2/inventory/purchase-orders?limit=20',
      'http://localhost:8080/api/v2/inventory/goods-received-notes?limit=20',
      'http://localhost:8080/api/v2/inventory/requisitions?limit=20',
      'http://localhost:8080/api/v2/inventory/transfers?limit=20',
      'http://localhost:8080/api/v2/pharmacy/controlled-substances/register?limit=20',
    ]);
  });

  it('loads inventory item detail through the generated Rust V2 endpoint', async () => {
    const controller = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(jsonResponse({
      data: {
        id: 'item-1',
        category_id: 'category-1',
        code: 'PARA500',
        name: 'Paracetamol 500mg',
        item_type: 'medication',
        unit: 'tablet',
        controlled: false,
      },
      meta: {},
    }));

    await expect(inventoryApi.getInventoryItem('item-1', {
      signal: controller.signal,
    })).resolves.toMatchObject({
      id: 'item-1',
      code: 'PARA500',
      name: 'Paracetamol 500mg',
      controlled: false,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/inventory/items/item-1',
      expect.objectContaining({
        method: 'GET',
        signal: controller.signal,
      }),
    );
  });

  it('threads location filters through the Rust V2 inventory item list', async () => {
    const controller = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(jsonResponse({
      data: [
        {
          id: 'item-1',
          category_id: 'category-1',
          category_name: 'Medication',
          code: 'PARA500',
          sku: 'PARA500',
          name: 'Paracetamol 500mg',
          item_type: 'medication',
          unit: 'tablet',
          unit_of_measure: 'tablet',
          controlled: false,
          is_controlled: false,
          total_stock: 100,
          nearest_expiry: '2027-01-31',
        },
      ],
      page: { limit: 24, has_next: false, next_cursor: null },
      meta: {},
    }));

    await expect(inventoryApi.getInventoryItems({
      location: 'location-1',
      page_size: 24,
    }, {
      signal: controller.signal,
    })).resolves.toMatchObject({
      results: [
        expect.objectContaining({
          id: 'item-1',
          sku: 'PARA500',
          total_stock: 100,
          nearest_expiry: '2027-01-31',
        }),
      ],
    });

    const [url, init] = globalThis.fetch.mock.calls[0];
    const requestUrl = new URL(url);
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe('http://localhost:8080/api/v2/inventory/items');
    expect(requestUrl.searchParams.get('location')).toBe('location-1');
    expect(requestUrl.searchParams.get('limit')).toBe('24');
    expect(init).toEqual(expect.objectContaining({
      method: 'GET',
      signal: controller.signal,
    }));
  });

  it('loads storage location detail and location stock through generated Rust V2 endpoints', async () => {
    const controller = new AbortController();
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'location-1',
          code: 'PHARM',
          name: 'Pharmacy Store',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            item_id: 'item-1',
            item_name: 'Paracetamol 500mg',
            location_id: 'location-1',
            location_name: 'Pharmacy Store',
            quantity_on_hand: 100,
            batch_count: 1,
            earliest_expiry: '2027-01-31',
            last_received_at: '2026-05-12T08:00:00Z',
          },
        ],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }));

    await expect(inventoryApi.getStorageLocation('location-1', {
      signal: controller.signal,
    })).resolves.toMatchObject({
      id: 'location-1',
      code: 'PHARM',
      name: 'Pharmacy Store',
    });
    await expect(inventoryApi.getLocationStock('location-1', {
      page_size: 20,
      signal: controller.signal,
    })).resolves.toEqual([
      expect.objectContaining({
        item_id: 'item-1',
        item_name: 'Paracetamol 500mg',
        location_id: 'location-1',
        quantity_on_hand: 100,
      }),
    ]);

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal])).toEqual([
      ['http://localhost:8080/api/v2/inventory/storage-locations/location-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/inventory/storage-locations/location-1/stock?limit=20', 'GET', controller.signal],
    ]);
  });

  it('loads inventory item tab data through generated item-scoped Rust V2 endpoints', async () => {
    const controller = new AbortController();
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'movement-1',
            item_id: 'item-1',
            item_name: 'Paracetamol 500mg',
            location_id: 'location-1',
            movement_type: 'receipt',
            quantity: 100,
            balance_after: 100,
            reason: 'stock_receipt',
            created_at: '2026-05-12T08:00:00Z',
          },
        ],
        page: { limit: 50, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'batch-1',
            item_id: 'item-1',
            item_name: 'Paracetamol 500mg',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            batch_number: 'B-001',
            expires_on: '2027-01-31',
            quantity_on_hand: 100,
            received_at: '2026-05-12T08:00:00Z',
          },
        ],
        page: { limit: 100, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            item_id: 'item-1',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            quantity_on_hand: 100,
          },
        ],
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            item_id: 'item-1',
            location_id: 'location-1',
            location_name: 'Main Pharmacy',
            quantity_on_hand: 100,
          },
        ],
        meta: {},
      }));

    await expect(inventoryApi.getItemMovements('item-1', {
      page_size: 50,
      signal: controller.signal,
    })).resolves.toMatchObject({
      results: [expect.objectContaining({ id: 'movement-1', item_id: 'item-1' })],
    });
    await expect(inventoryApi.getItemExpiryTrackers('item-1', {
      signal: controller.signal,
    })).resolves.toEqual([
      expect.objectContaining({
        id: 'batch-1',
        batch_id: 'batch-1',
        item_id: 'item-1',
        expiry_date: '2027-01-31',
      }),
    ]);
    await expect(inventoryApi.getItemStockByLocation('item-1', {
      signal: controller.signal,
    })).resolves.toEqual([
      expect.objectContaining({
        item_id: 'item-1',
        location_id: 'location-1',
        quantity_on_hand: 100,
      }),
    ]);
    await expect(inventoryApi.getStockByItemLocation('item-1', {
      signal: controller.signal,
    })).resolves.toEqual([
      expect.objectContaining({
        item_id: 'item-1',
        location_id: 'location-1',
        quantity_on_hand: 100,
      }),
    ]);

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal])).toEqual([
      ['http://localhost:8080/api/v2/inventory/items/item-1/stock-movements?limit=50', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/inventory/items/item-1/stock-batches?limit=25', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/inventory/items/item-1/stock-by-location', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/inventory/items/item-1/stock-by-location', 'GET', controller.signal],
    ]);
  });

  it('loads procurement and controlled detail records through generated Rust V2 endpoints', async () => {
    const controller = new AbortController();
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'requested',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'internal-req-1',
          requesting_location_id: 'location-2',
          requesting_location_name: 'Ward Store',
          status: 'requested',
          created_at: '2026-05-12T08:05:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'po-1',
          supplier_name: 'Acme Medical',
          status: 'draft',
          created_at: '2026-05-12T08:10:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'grn-1',
          purchase_order_id: 'po-1',
          supplier_name: 'Acme Medical',
          status: 'received',
          received_at: '2026-05-12T08:15:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'transfer-1',
          item_id: 'item-1',
          item_name: 'Paracetamol',
          from_location_id: 'location-1',
          to_location_id: 'location-2',
          quantity: 5,
          status: 'requested',
          created_at: '2026-05-12T08:20:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'register-1',
          item_id: 'item-2',
          item_name: 'Morphine',
          location_id: 'location-1',
          movement_type: 'dispense',
          quantity_delta: -1,
          balance_after: 9,
          witness_user_id: 'user-2',
          created_at: '2026-05-12T08:25:00Z',
        },
        meta: {},
      }));

    await expect(inventoryApi.getRequisition('req-1', {
      signal: controller.signal,
    })).resolves.toMatchObject({ id: 'req-1' });
    await expect(inventoryApi.getInternalRequisition('internal-req-1', {
      signal: controller.signal,
    })).resolves.toMatchObject({ id: 'internal-req-1' });
    await expect(inventoryApi.getPurchaseOrder('po-1', {
      signal: controller.signal,
    })).resolves.toMatchObject({ id: 'po-1' });
    await expect(inventoryApi.getGRN('grn-1', {
      signal: controller.signal,
    })).resolves.toMatchObject({ id: 'grn-1' });
    await expect(inventoryApi.getTransferRequest('transfer-1', {
      signal: controller.signal,
    })).resolves.toMatchObject({ id: 'transfer-1' });
    await expect(inventoryApi.getControlledRegister('register-1', {
      signal: controller.signal,
    })).resolves.toMatchObject({ id: 'register-1' });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal])).toEqual([
      ['http://localhost:8080/api/v2/inventory/requisitions/req-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/inventory/requisitions/internal-req-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/inventory/purchase-orders/po-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/inventory/goods-received-notes/grn-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/inventory/transfers/transfer-1', 'GET', controller.signal],
      ['http://localhost:8080/api/v2/pharmacy/controlled-substances/register/register-1', 'GET', controller.signal],
    ]);
  });

  it('loads controlled register entries and records counts through generated Rust V2 endpoints', async () => {
    const controller = new AbortController();
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'entry-1',
            entry_number: 1,
            entry_type: 'receipt',
            quantity: 10,
            balance_before: 0,
            balance_after: 10,
            witness_user_id: null,
            created_at: '2026-05-12T08:00:00Z',
          },
          {
            id: 'entry-2',
            entry_number: 2,
            entry_type: 'dispense',
            quantity: -1,
            balance_before: 10,
            balance_after: 9,
            witness_user_id: 'user-2',
            created_at: '2026-05-12T08:25:00Z',
          },
        ],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          register_id: 'entry-2',
          current_balance: 9,
          computed_balance: 9,
          valid: true,
          checked_at: '2026-05-12T08:30:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'count-entry-1',
          item_id: 'item-2',
          item_name: 'Morphine',
          location_id: 'location-1',
          movement_type: 'count',
          quantity_delta: -1,
          balance_after: 8,
          witness_user_id: 'user-2',
          created_at: '2026-05-12T08:35:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          {
            id: 'entry-1',
            entry_number: 1,
            entry_type: 'receipt',
            quantity: 10,
            balance_before: 0,
            balance_after: 10,
            witness_user_id: null,
            created_at: '2026-05-12T08:00:00Z',
          },
          {
            id: 'count-entry-1',
            entry_number: 3,
            entry_type: 'count',
            quantity: -1,
            balance_before: 9,
            balance_after: 8,
            notes: 'count mismatch',
            witness_user_id: 'user-2',
            created_at: '2026-05-12T08:35:00Z',
          },
        ],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }));

    await expect(inventoryApi.getControlledRegisterEntries('entry-2', {
      page_size: 20,
      signal: controller.signal,
    })).resolves.toMatchObject({
      results: [
        expect.objectContaining({
          id: 'entry-1',
          entry_type: 'receipt',
          quantity: 10,
          balance_before: 0,
          balance_after: 10,
        }),
        expect.objectContaining({
          id: 'entry-2',
          entry_type: 'dispense',
          quantity: -1,
          balance_before: 10,
          balance_after: 9,
        }),
      ],
    });
    await expect(inventoryApi.validateRegisterBalance('entry-2', {
      signal: controller.signal,
    })).resolves.toMatchObject({
      register_id: 'entry-2',
      current_balance: 9,
      computed_balance: 9,
      valid: true,
    });
    await expect(inventoryApi.recordControlledCount({
      register: 'entry-2',
      actual_count: 8,
      witness: 'user-2',
    }, {
      signal: controller.signal,
    })).resolves.toMatchObject({
      id: 'count-entry-1',
      movement_type: 'count',
      balance_after: 8,
    });
    await expect(inventoryApi.getControlledDiscrepancies({ register: 'entry-2', page_size: 20 }, {
      signal: controller.signal,
    })).resolves.toMatchObject({
      results: [
        expect.objectContaining({
          id: 'count-entry-1',
          status: 'pending',
          controlled_register: 'entry-2',
          expected_balance: 9,
          actual_count: 8,
          discrepancy_amount: -1,
        }),
      ],
    });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.signal, init.body])).toEqual([
      [
        'http://localhost:8080/api/v2/pharmacy/controlled-substances/register/entry-2/entries?limit=20',
        'GET',
        controller.signal,
        undefined,
      ],
      [
        'http://localhost:8080/api/v2/pharmacy/controlled-substances/register/entry-2/balance-validation',
        'GET',
        controller.signal,
        undefined,
      ],
      [
        'http://localhost:8080/api/v2/pharmacy/controlled-substances/register/entry-2/counts',
        'POST',
        controller.signal,
        JSON.stringify({
          actual_count: 8,
          witness_user_id: 'user-2',
          notes: null,
        }),
      ],
      [
        'http://localhost:8080/api/v2/pharmacy/controlled-substances/register/entry-2/entries?limit=20',
        'GET',
        controller.signal,
        undefined,
      ],
    ]);
  });

  it('returns safe local fallbacks for inventory screens without a Rust V2 contract', async () => {
    await expect(inventoryApi.getStandingOrders()).resolves.toMatchObject({ results: [], count: 0 });
    await expect(inventoryApi.getConsumptionAnalytics()).resolves.toMatchObject({
      period: '30d',
      results: [],
      total_consumption: 0,
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('routes inventory creation and approval workflows through generated Rust V2 endpoints', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'requested',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'pending',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'approved',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'po-1',
          supplier_name: 'Acme Medical',
          status: 'draft',
          created_at: '2026-05-12T08:05:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'po-1',
          supplier_name: 'Acme Medical',
          status: 'approved',
          created_at: '2026-05-12T08:05:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'po-1',
          supplier_name: 'Acme Medical',
          status: 'sent',
          created_at: '2026-05-12T08:05:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'grn-1',
          purchase_order_id: 'po-1',
          supplier_name: 'Acme Medical',
          status: 'pending_inspection',
          received_at: '2026-05-12T08:10:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'grn-1',
          purchase_order_id: 'po-1',
          supplier_name: 'Acme Medical',
          status: 'inspecting',
          received_at: '2026-05-12T08:10:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'grn-1',
          purchase_order_id: 'po-1',
          supplier_name: 'Acme Medical',
          status: 'accepted',
          received_at: '2026-05-12T08:10:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'transfer-1',
          item_id: 'item-1',
          item_name: 'Paracetamol',
          from_location_id: 'location-1',
          to_location_id: 'location-2',
          quantity: 5,
          status: 'requested',
          created_at: '2026-05-12T08:15:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'register-1',
          item_id: 'item-2',
          item_name: 'Morphine',
          location_id: 'location-1',
          movement_type: 'dispense',
          quantity_delta: -1,
          balance_after: 9,
          witness_user_id: 'user-2',
          created_at: '2026-05-12T08:20:00Z',
        },
        meta: {},
      }));

    await expect(inventoryApi.createRequisition({
      requesting_location: 'location-1',
    }, { signal })).resolves.toMatchObject({ id: 'req-1' });
    await expect(inventoryApi.submitRequisition('req-1', { signal })).resolves.toMatchObject({
      id: 'req-1',
      status: 'pending',
    });
    await expect(inventoryApi.approveRequisition('req-1', { signal })).resolves.toMatchObject({
      id: 'req-1',
      status: 'approved',
    });
    await expect(inventoryApi.createPurchaseOrder({
      supplier: { name: 'Acme Medical' },
    }, { signal })).resolves.toMatchObject({ id: 'po-1' });
    await expect(inventoryApi.approvePurchaseOrder('po-1', { signal })).resolves.toMatchObject({
      id: 'po-1',
      status: 'approved',
    });
    await expect(inventoryApi.sendPurchaseOrder('po-1', { signal })).resolves.toMatchObject({
      id: 'po-1',
      status: 'sent',
    });
    await expect(inventoryApi.createGRN({
      purchase_order: 'po-1',
    }, { signal })).resolves.toMatchObject({ id: 'grn-1', status: 'pending_inspection' });
    await expect(inventoryApi.inspectGRN('grn-1', { signal })).resolves.toMatchObject({
      id: 'grn-1',
      status: 'inspecting',
    });
    await expect(inventoryApi.acceptGRN('grn-1', { signal })).resolves.toMatchObject({
      id: 'grn-1',
      status: 'accepted',
    });
    await expect(inventoryApi.createTransferRequest({
      item: 'item-1',
      from_location: 'location-1',
      to_location: 'location-2',
      quantity: '5',
    }, { signal })).resolves.toMatchObject({ id: 'transfer-1' });
    await expect(inventoryApi.dispenseControlledSubstance({
      item: 'item-2',
      location: 'location-1',
      quantity: 1,
      witness: 'user-2',
    }, { signal })).resolves.toMatchObject({ id: 'register-1', quantity_delta: -1 });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body, init.signal])).toEqual([
      [
        'http://localhost:8080/api/v2/inventory/requisitions',
        'POST',
        JSON.stringify({ requesting_location_id: 'location-1' }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/requisitions/req-1/submit',
        'POST',
        undefined,
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/requisitions/req-1/approve',
        'POST',
        undefined,
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/purchase-orders',
        'POST',
        JSON.stringify({ supplier_name: 'Acme Medical' }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/purchase-orders/po-1/approve',
        'POST',
        undefined,
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/purchase-orders/po-1/send',
        'POST',
        undefined,
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/goods-received-notes',
        'POST',
        JSON.stringify({ purchase_order_id: 'po-1' }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/goods-received-notes/grn-1/inspect',
        'POST',
        undefined,
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/goods-received-notes/grn-1/accept',
        'POST',
        undefined,
        signal,
      ],
      [
        'http://localhost:8080/api/v2/inventory/transfers',
        'POST',
        JSON.stringify({
          item_id: 'item-1',
          from_location_id: 'location-1',
          to_location_id: 'location-2',
          quantity: 5,
        }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/pharmacy/controlled-substances/register',
        'POST',
        JSON.stringify({
          item_id: 'item-2',
          location_id: 'location-1',
          movement_type: 'dispense',
          quantity_delta: -1,
          witness_user_id: 'user-2',
        }),
        signal,
      ],
    ]);
  });

  it('routes internal requisition actions through generated Rust V2 endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'internal-req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'requested',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'internal-req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'pending',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'internal-req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'approved',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'internal-req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'fulfilled',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }));

    await expect(inventoryApi.createInternalRequisition({
      requesting_location: 'location-1',
    })).resolves.toMatchObject({
      id: 'internal-req-1',
      status: 'pending_approval',
    });
    await expect(inventoryApi.submitInternalRequisition('internal-req-1')).resolves.toMatchObject({
      id: 'internal-req-1',
      status: 'pending_approval',
    });
    await expect(inventoryApi.approveInternalRequisition('internal-req-1')).resolves.toMatchObject({
      id: 'internal-req-1',
      status: 'approved',
    });
    await expect(inventoryApi.fulfillInternalRequisition('internal-req-1')).resolves.toMatchObject({
      id: 'internal-req-1',
      status: 'fulfilled',
    });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      [
        'http://localhost:8080/api/v2/inventory/requisitions',
        'POST',
        JSON.stringify({ requesting_location_id: 'location-1' }),
      ],
      [
        'http://localhost:8080/api/v2/inventory/requisitions/internal-req-1/submit',
        'POST',
        undefined,
      ],
      [
        'http://localhost:8080/api/v2/inventory/requisitions/internal-req-1/approve',
        'POST',
        undefined,
      ],
      [
        'http://localhost:8080/api/v2/inventory/requisitions/internal-req-1/fulfill',
        'POST',
        undefined,
      ],
    ]);
  });

  it('routes requisition reject and cancel actions through generated Rust V2 endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'rejected',
          rejection_reason: 'Duplicate request',
          rejected_at: '2026-05-12T08:30:00Z',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'internal-req-1',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'rejected',
          rejection_reason: 'No stock available',
          rejected_at: '2026-05-12T08:35:00Z',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'internal-req-2',
          requesting_location_id: 'location-1',
          requesting_location_name: 'Main Store',
          status: 'cancelled',
          cancelled_at: '2026-05-12T08:40:00Z',
          created_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }));

    await expect(inventoryApi.rejectRequisition('req-1', {
      reason: 'Duplicate request',
    })).resolves.toMatchObject({
      id: 'req-1',
      status: 'rejected',
      rejection_reason: 'Duplicate request',
    });
    await expect(inventoryApi.rejectInternalRequisition('internal-req-1', {
      reason: 'No stock available',
    })).resolves.toMatchObject({
      id: 'internal-req-1',
      status: 'rejected',
      rejection_reason: 'No stock available',
    });
    await expect(inventoryApi.cancelInternalRequisition('internal-req-2')).resolves.toMatchObject({
      id: 'internal-req-2',
      status: 'cancelled',
    });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      [
        'http://localhost:8080/api/v2/inventory/requisitions/req-1/reject',
        'POST',
        JSON.stringify({ reason: 'Duplicate request' }),
      ],
      [
        'http://localhost:8080/api/v2/inventory/requisitions/internal-req-1/reject',
        'POST',
        JSON.stringify({ reason: 'No stock available' }),
      ],
      [
        'http://localhost:8080/api/v2/inventory/requisitions/internal-req-2/cancel',
        'POST',
        undefined,
      ],
    ]);
  });

  it('fails closed for inventory actions without generated Rust V2 contracts', async () => {
    await expect(inventoryApi.createCategory({ name: 'Medication' })).rejects.toThrow('/api/v2 inventory category mutation contract');
    await expect(inventoryApi.createSupplier({ name: 'Acme Medical' })).rejects.toThrow('/api/v2 supplier contract');
    await expect(inventoryApi.createStorageLocation({ name: 'Main Store' })).rejects.toThrow('/api/v2 storage location mutation contract');
    await expect(inventoryApi.createInventoryItem({ name: 'Paracetamol' })).rejects.toThrow('/api/v2 inventory item mutation contract');
    await expect(inventoryApi.createStockMovement({ item: 'item-1' })).rejects.toThrow('/api/v2 stock movement mutation contract');
    await expect(inventoryApi.approveTransferRequest('transfer-1')).rejects.toThrow('/api/v2 stock transfer action contract');
    await expect(inventoryApi.createStandingOrder({})).rejects.toThrow('/api/v2 standing order contract');
    await expect(inventoryApi.createInventoryAudit({})).rejects.toThrow('/api/v2 inventory audit contract');

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
