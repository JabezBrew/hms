import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useExpiredBatches,
  useExpiringSoonBatches,
  useGRN,
  useGRNs,
  useInventoryItem,
  useItemExpiryTrackers,
  useItemMovements,
  useItemStockByLocation,
  usePurchaseOrder,
  usePurchaseOrders,
  useRequisition,
  useRequisitions,
  useStockMovements,
} from '../useInventoryQueries';
import { inventoryApi } from '@/features/inventory/api';

vi.mock('@/features/inventory/api', () => ({
  inventoryApi: {
    getExpiredBatches: vi.fn(),
    getExpiringSoonBatches: vi.fn(),
    getGRN: vi.fn(),
    getGRNs: vi.fn(),
    getInventoryItem: vi.fn(),
    getItemExpiryTrackers: vi.fn(),
    getItemMovements: vi.fn(),
    getItemStockByLocation: vi.fn(),
    getPurchaseOrder: vi.fn(),
    getPurchaseOrders: vi.fn(),
    getRequisition: vi.fn(),
    getRequisitions: vi.fn(),
    getStockMovements: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 0,
        retry: false,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useInventoryQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inventoryApi.getExpiredBatches.mockResolvedValue([]);
    inventoryApi.getExpiringSoonBatches.mockResolvedValue([]);
    inventoryApi.getGRN.mockResolvedValue({});
    inventoryApi.getGRNs.mockResolvedValue({ results: [] });
    inventoryApi.getInventoryItem.mockResolvedValue({});
    inventoryApi.getItemExpiryTrackers.mockResolvedValue([]);
    inventoryApi.getItemMovements.mockResolvedValue({ results: [] });
    inventoryApi.getItemStockByLocation.mockResolvedValue([]);
    inventoryApi.getPurchaseOrder.mockResolvedValue({});
    inventoryApi.getPurchaseOrders.mockResolvedValue({ results: [] });
    inventoryApi.getRequisition.mockResolvedValue({});
    inventoryApi.getRequisitions.mockResolvedValue({ results: [] });
    inventoryApi.getStockMovements.mockResolvedValue({ results: [] });
  });

  it('threads React Query AbortSignal into inventory item stock reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useInventoryItem('item-1'), { wrapper });
    renderHook(() => useItemMovements('item-1', { page_size: 10 }), { wrapper });
    renderHook(() => useItemExpiryTrackers('item-1'), { wrapper });
    renderHook(() => useItemStockByLocation('item-1'), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getInventoryItem).toHaveBeenCalledWith('item-1', {
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getItemMovements).toHaveBeenCalledWith('item-1', {
        page_size: 10,
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getItemExpiryTrackers).toHaveBeenCalledWith('item-1', {
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getItemStockByLocation).toHaveBeenCalledWith('item-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into inventory movement and expiry reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useStockMovements({ movement_type: 'receipt' }), { wrapper });
    renderHook(() => useExpiredBatches(), { wrapper });
    renderHook(() => useExpiringSoonBatches(45), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getStockMovements).toHaveBeenCalledWith({
        movement_type: 'receipt',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getExpiredBatches).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getExpiringSoonBatches).toHaveBeenCalledWith(45, {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into inventory procurement reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useRequisitions({ status: 'pending' }), { wrapper });
    renderHook(() => useRequisition('req-1'), { wrapper });
    renderHook(() => usePurchaseOrders({ status: 'approved' }), { wrapper });
    renderHook(() => usePurchaseOrder('po-1'), { wrapper });
    renderHook(() => useGRNs({ status: 'received' }), { wrapper });
    renderHook(() => useGRN('grn-1'), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getRequisitions).toHaveBeenCalledWith({
        status: 'pending',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getRequisition).toHaveBeenCalledWith('req-1', {
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getPurchaseOrders).toHaveBeenCalledWith({
        status: 'approved',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getPurchaseOrder).toHaveBeenCalledWith('po-1', {
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getGRNs).toHaveBeenCalledWith({
        status: 'received',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getGRN).toHaveBeenCalledWith('grn-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });
});
