import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useABCAnalysis,
  useBatchRecommendations,
  useConsumptionAnalytics,
  useControlledSubstanceReport,
  useControlledRegister,
  useControlledRegisterEntries,
  useControlledRegisters,
  useDueStandingOrders,
  useExpiredBatches,
  useExpiringSoonBatches,
  useExpiryForecast,
  useExpiryTrackers,
  useGRN,
  useGRNs,
  useInventoryAudit,
  useInventoryAudits,
  useInventoryCategories,
  useInventoryCategory,
  useInventoryItem,
  useItemExpiryTrackers,
  useItemMovements,
  useItemStockByLocation,
  useLocationsByType,
  usePendingDiscrepancies,
  usePurchaseOrder,
  usePurchaseOrders,
  useRequisition,
  useRequisitions,
  useStockMovements,
  useStockValuation,
  useStandingOrder,
  useStandingOrders,
  useSupplier,
  useSupplierPerformance,
  useTransferRequest,
  useTransferRequests,
  useValidateRegisterBalance,
} from '../useInventoryQueries';
import { inventoryApi } from '@/features/inventory/api';

vi.mock('@/features/inventory/api', () => ({
  inventoryApi: {
    getControlledRegister: vi.fn(),
    getControlledRegisterEntries: vi.fn(),
    getControlledRegisters: vi.fn(),
    getABCAnalysis: vi.fn(),
    getBatchRecommendations: vi.fn(),
    getCategories: vi.fn(),
    getCategory: vi.fn(),
    getConsumptionAnalytics: vi.fn(),
    getControlledSubstanceReport: vi.fn(),
    getDueStandingOrders: vi.fn(),
    getExpiredBatches: vi.fn(),
    getExpiringSoonBatches: vi.fn(),
    getExpiryForecast: vi.fn(),
    getExpiryTrackers: vi.fn(),
    getGRN: vi.fn(),
    getGRNs: vi.fn(),
    getInventoryAudit: vi.fn(),
    getInventoryAudits: vi.fn(),
    getInventoryItem: vi.fn(),
    getItemExpiryTrackers: vi.fn(),
    getItemMovements: vi.fn(),
    getItemStockByLocation: vi.fn(),
    getLocationsByType: vi.fn(),
    getPendingDiscrepancies: vi.fn(),
    getPurchaseOrder: vi.fn(),
    getPurchaseOrders: vi.fn(),
    getRequisition: vi.fn(),
    getRequisitions: vi.fn(),
    getStockMovements: vi.fn(),
    getStockValuation: vi.fn(),
    getStandingOrder: vi.fn(),
    getStandingOrders: vi.fn(),
    getSupplier: vi.fn(),
    getSupplierPerformance: vi.fn(),
    getTransferRequest: vi.fn(),
    getTransferRequests: vi.fn(),
    validateRegisterBalance: vi.fn(),
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
    inventoryApi.getABCAnalysis.mockResolvedValue({});
    inventoryApi.getBatchRecommendations.mockResolvedValue([]);
    inventoryApi.getControlledRegister.mockResolvedValue({});
    inventoryApi.getControlledRegisterEntries.mockResolvedValue({ results: [] });
    inventoryApi.getControlledRegisters.mockResolvedValue({ results: [] });
    inventoryApi.getCategories.mockResolvedValue([]);
    inventoryApi.getCategory.mockResolvedValue({});
    inventoryApi.getConsumptionAnalytics.mockResolvedValue({});
    inventoryApi.getControlledSubstanceReport.mockResolvedValue({});
    inventoryApi.getDueStandingOrders.mockResolvedValue([]);
    inventoryApi.getExpiredBatches.mockResolvedValue([]);
    inventoryApi.getExpiringSoonBatches.mockResolvedValue([]);
    inventoryApi.getExpiryForecast.mockResolvedValue({});
    inventoryApi.getExpiryTrackers.mockResolvedValue({ results: [] });
    inventoryApi.getGRN.mockResolvedValue({});
    inventoryApi.getGRNs.mockResolvedValue({ results: [] });
    inventoryApi.getInventoryAudit.mockResolvedValue({});
    inventoryApi.getInventoryAudits.mockResolvedValue({ results: [] });
    inventoryApi.getInventoryItem.mockResolvedValue({});
    inventoryApi.getItemExpiryTrackers.mockResolvedValue([]);
    inventoryApi.getItemMovements.mockResolvedValue({ results: [] });
    inventoryApi.getItemStockByLocation.mockResolvedValue([]);
    inventoryApi.getLocationsByType.mockResolvedValue([]);
    inventoryApi.getPendingDiscrepancies.mockResolvedValue([]);
    inventoryApi.getPurchaseOrder.mockResolvedValue({});
    inventoryApi.getPurchaseOrders.mockResolvedValue({ results: [] });
    inventoryApi.getRequisition.mockResolvedValue({});
    inventoryApi.getRequisitions.mockResolvedValue({ results: [] });
    inventoryApi.getStockMovements.mockResolvedValue({ results: [] });
    inventoryApi.getStockValuation.mockResolvedValue({});
    inventoryApi.getStandingOrder.mockResolvedValue({});
    inventoryApi.getStandingOrders.mockResolvedValue({ results: [] });
    inventoryApi.getSupplier.mockResolvedValue({});
    inventoryApi.getSupplierPerformance.mockResolvedValue({});
    inventoryApi.getTransferRequest.mockResolvedValue({});
    inventoryApi.getTransferRequests.mockResolvedValue({ results: [] });
    inventoryApi.validateRegisterBalance.mockResolvedValue({});
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

  it('threads React Query AbortSignal into inventory metadata reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useInventoryCategories({ search: 'med' }), { wrapper });
    renderHook(() => useLocationsByType('pharmacy'), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getCategories).toHaveBeenCalledWith({
        search: 'med',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getLocationsByType).toHaveBeenCalledWith('pharmacy', {
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

  it('threads React Query AbortSignal into controlled substance register reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useControlledRegisters({ location: 'loc-1' }), { wrapper });
    renderHook(() => useControlledRegister('register-1'), { wrapper });
    renderHook(() => useControlledRegisterEntries('register-1', { page_size: 25 }), { wrapper });
    renderHook(() => useValidateRegisterBalance('register-1'), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getControlledRegisters).toHaveBeenCalledWith({
        location: 'loc-1',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getControlledRegister).toHaveBeenCalledWith('register-1', {
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getControlledRegisterEntries).toHaveBeenCalledWith('register-1', {
        page_size: 25,
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.validateRegisterBalance).toHaveBeenCalledWith('register-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into inventory transfer request reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useTransferRequests({ status: 'requested' }), { wrapper });
    renderHook(() => useTransferRequest('transfer-1'), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getTransferRequests).toHaveBeenCalledWith({
        status: 'requested',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getTransferRequest).toHaveBeenCalledWith('transfer-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into inventory reference and expiry reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useInventoryCategory('category-1'), { wrapper });
    renderHook(() => useSupplier('supplier-1'), { wrapper });
    renderHook(() => useBatchRecommendations('item-1', { quantity: 2 }), { wrapper });
    renderHook(() => useExpiryTrackers({ location: 'loc-1' }), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getCategory).toHaveBeenCalledWith('category-1', {
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getSupplier).toHaveBeenCalledWith('supplier-1', {
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getBatchRecommendations).toHaveBeenCalledWith('item-1', {
        quantity: 2,
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getExpiryTrackers).toHaveBeenCalledWith({
        location: 'loc-1',
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into standing order and discrepancy reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useStandingOrders({ is_active: true }), { wrapper });
    renderHook(() => useStandingOrder('standing-1'), { wrapper });
    renderHook(() => useDueStandingOrders(), { wrapper });
    renderHook(() => usePendingDiscrepancies(), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getStandingOrders).toHaveBeenCalledWith({
        is_active: true,
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getStandingOrder).toHaveBeenCalledWith('standing-1', {
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getDueStandingOrders).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getPendingDiscrepancies).toHaveBeenCalledWith({
        signal: expect.any(AbortSignal),
      });
    });
  });

  it('threads React Query AbortSignal into inventory analytics and audit reads', async () => {
    const wrapper = createWrapper();

    renderHook(() => useConsumptionAnalytics({ period: '30d' }), { wrapper });
    renderHook(() => useABCAnalysis({ period_days: 30 }), { wrapper });
    renderHook(() => useSupplierPerformance({ supplier: 'supplier-1' }), { wrapper });
    renderHook(() => useExpiryForecast({ days: 45 }), { wrapper });
    renderHook(() => useStockValuation({ location: 'loc-1' }), { wrapper });
    renderHook(() => useControlledSubstanceReport({ register: 'register-1' }), { wrapper });
    renderHook(() => useInventoryAudits({ status: 'open' }), { wrapper });
    renderHook(() => useInventoryAudit('audit-1'), { wrapper });

    await waitFor(() => {
      expect(inventoryApi.getConsumptionAnalytics).toHaveBeenCalledWith({
        period: '30d',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getABCAnalysis).toHaveBeenCalledWith({
        period_days: 30,
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getSupplierPerformance).toHaveBeenCalledWith({
        supplier: 'supplier-1',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getExpiryForecast).toHaveBeenCalledWith({
        days: 45,
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getStockValuation).toHaveBeenCalledWith({
        location: 'loc-1',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getControlledSubstanceReport).toHaveBeenCalledWith({
        register: 'register-1',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getInventoryAudits).toHaveBeenCalledWith({
        status: 'open',
        signal: expect.any(AbortSignal),
      });
      expect(inventoryApi.getInventoryAudit).toHaveBeenCalledWith('audit-1', {
        signal: expect.any(AbortSignal),
      });
    });
  });
});
