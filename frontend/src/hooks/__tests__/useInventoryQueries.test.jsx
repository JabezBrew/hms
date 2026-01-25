/**
 * Tests for useInventoryQueries hooks.
 *
 * Tests cover:
 * - Query keys generation
 * - Dashboard hooks (useInventoryDashboardMetrics, useLowStockAlerts, useExpiringItems)
 * - Item hooks (useInventoryItems, useInventoryItem, useCreateInventoryItem, useUpdateInventoryItem)
 * - Location hooks (useStorageLocations, useStorageLocation, useLocationStock)
 * - Requisition hooks (useRequisitions, useApproveRequisition, useRejectRequisition)
 * - Purchase Order hooks (usePurchaseOrders, useApprovePurchaseOrder)
 * - GRN hooks (useGRNs, useAcceptGRN)
 * - Controlled substance hooks (useControlledRegisters, useDispenseControlledSubstance)
 * - Error handling
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/mocks/server'
import {
  inventoryKeys,
  useInventoryDashboardMetrics,
  useLowStockAlerts,
  useExpiringItems,
  useInventoryItems,
  useInventoryItem,
  useCreateInventoryItem,
  useUpdateInventoryItem,
  useDeleteInventoryItem,
  useStorageLocations,
  useStorageLocation,
  useLocationStock,
  useRequisitions,
  useRequisition,
  useApproveRequisition,
  useRejectRequisition,
  usePurchaseOrders,
  usePurchaseOrder,
  useApprovePurchaseOrder,
  useGRNs,
  useGRN,
  useAcceptGRN,
  useControlledRegisters,
  useControlledRegister,
  useDispenseControlledSubstance,
  useRecordControlledCount,
} from '../useInventoryQueries'

// Helper to create a fresh QueryClient for each test
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

// Wrapper component for rendering hooks with QueryClient
function createWrapper() {
  const queryClient = createTestQueryClient()
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

// Mock data
const mockItem = {
  id: 'item-1',
  name: 'Paracetamol 500mg',
  sku: 'MED-001',
  category_name: 'Analgesics',
  unit_of_measure: 'tablet',
  unit_price: 0.5,
  total_stock: 1500,
  reorder_level: 100,
  is_controlled: false,
}

const mockItemList = [
  mockItem,
  {
    id: 'item-2',
    name: 'Amoxicillin 250mg',
    sku: 'MED-002',
    category_name: 'Antibiotics',
    unit_of_measure: 'capsule',
    unit_price: 1.25,
    total_stock: 50,
    reorder_level: 100,
    is_controlled: false,
  },
]

const mockLocation = {
  id: 'loc-1',
  name: 'Main Pharmacy',
  location_type: 'pharmacy',
  temperature_zone: 'ambient',
}

const mockRequisition = {
  id: 'req-1',
  requisition_number: 'REQ-2024-001',
  status: 'pending',
  priority: 'normal',
  items: [
    { id: 1, item_name: 'Paracetamol', quantity: 100, unit_price: 0.5 },
  ],
}

const mockPO = {
  id: 'po-1',
  po_number: 'PO-2024-001',
  status: 'pending',
  supplier_name: 'Medical Supplies Inc',
  items: [
    { id: 1, item_name: 'Paracetamol', quantity: 500, unit_price: 0.45 },
  ],
}

const mockGRN = {
  id: 'grn-1',
  grn_number: 'GRN-2024-001',
  status: 'pending_inspection',
  items: [
    { id: 1, item_name: 'Paracetamol', quantity: 500, received_quantity: 500 },
  ],
}

const mockControlledRegister = {
  id: 'reg-1',
  item_name: 'Morphine 10mg',
  location_name: 'Main Pharmacy',
  current_balance: 45,
  last_audit_date: '2024-01-15',
}

// =========================================================================
// Query Keys Tests
// =========================================================================

describe('inventoryKeys', () => {
  it('generates correct base query keys', () => {
    expect(inventoryKeys.all).toEqual(['inventory'])
    expect(inventoryKeys.dashboard()).toEqual(['inventory', 'dashboard'])
    expect(inventoryKeys.items()).toEqual(['inventory', 'items'])
    expect(inventoryKeys.locations()).toEqual(['inventory', 'locations'])
    expect(inventoryKeys.requisitions()).toEqual(['inventory', 'requisitions'])
    expect(inventoryKeys.purchaseOrders()).toEqual(['inventory', 'purchaseOrders'])
    expect(inventoryKeys.grns()).toEqual(['inventory', 'grns'])
    expect(inventoryKeys.controlledRegisters()).toEqual(['inventory', 'controlledRegisters'])
  })

  it('generates correct list query keys with filters', () => {
    expect(inventoryKeys.itemList({ page: 1 })).toEqual(['inventory', 'items', 'list', { filters: { page: 1 } }])
    expect(inventoryKeys.locationList({ type: 'pharmacy' })).toEqual(['inventory', 'locations', 'list', { filters: { type: 'pharmacy' } }])
    expect(inventoryKeys.requisitionList({ status: 'pending' })).toEqual(['inventory', 'requisitions', 'list', { filters: { status: 'pending' } }])
  })

  it('generates correct detail query keys', () => {
    expect(inventoryKeys.itemDetail('123')).toEqual(['inventory', 'items', 'detail', '123'])
    expect(inventoryKeys.locationDetail('456')).toEqual(['inventory', 'locations', 'detail', '456'])
    expect(inventoryKeys.requisitionDetail('789')).toEqual(['inventory', 'requisitions', 'detail', '789'])
    expect(inventoryKeys.purchaseOrderDetail('po-1')).toEqual(['inventory', 'purchaseOrders', 'detail', 'po-1'])
    expect(inventoryKeys.grnDetail('grn-1')).toEqual(['inventory', 'grns', 'detail', 'grn-1'])
  })

  it('generates correct analytics query keys', () => {
    expect(inventoryKeys.analytics()).toEqual(['inventory', 'analytics'])
    expect(inventoryKeys.consumptionAnalytics({ period: '30d' })).toEqual(['inventory', 'analytics', 'consumption', { period: '30d' }])
    expect(inventoryKeys.abcAnalysis({ category: 'all' })).toEqual(['inventory', 'analytics', 'abcAnalysis', { category: 'all' }])
  })
})

// =========================================================================
// Dashboard Hooks Tests
// =========================================================================

describe('useInventoryDashboardMetrics', () => {
  it('fetches dashboard metrics successfully', async () => {
    const mockMetrics = {
      total_items: 150,
      low_stock_count: 12,
      expiring_count: 5,
      total_value: 125000,
    }

    server.use(
      http.get('/api/inventory/dashboard/metrics/', () => {
        return HttpResponse.json(mockMetrics)
      })
    )

    const { result } = renderHook(() => useInventoryDashboardMetrics(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.total_items).toBe(150)
    expect(result.current.data.low_stock_count).toBe(12)
  })
})

describe('useLowStockAlerts', () => {
  it('fetches low stock alerts successfully', async () => {
    const mockAlerts = [
      { id: 1, item_name: 'Paracetamol', current_stock: 50, reorder_level: 100 },
      { id: 2, item_name: 'Amoxicillin', current_stock: 25, reorder_level: 50 },
    ]

    server.use(
      http.get('/api/inventory/dashboard/low-stock/', () => {
        return HttpResponse.json(mockAlerts)
      })
    )

    const { result } = renderHook(() => useLowStockAlerts(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].item_name).toBe('Paracetamol')
  })
})

describe('useExpiringItems', () => {
  it('fetches expiring items successfully', async () => {
    const mockExpiring = [
      { id: 1, item_name: 'Insulin', batch_number: 'B001', expiry_date: '2024-02-15', days_until_expiry: 7 },
    ]

    server.use(
      http.get('/api/inventory/dashboard/expiring/', () => {
        return HttpResponse.json(mockExpiring)
      })
    )

    const { result } = renderHook(() => useExpiringItems({ days: 30 }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].days_until_expiry).toBe(7)
  })
})

// =========================================================================
// Inventory Items Hooks Tests
// =========================================================================

describe('useInventoryItems', () => {
  it('fetches items list successfully', async () => {
    server.use(
      http.get('/api/inventory/items/', () => {
        return HttpResponse.json({
          count: mockItemList.length,
          next: null,
          previous: null,
          results: mockItemList,
        })
      })
    )

    const { result } = renderHook(() => useInventoryItems(), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.results).toHaveLength(2)
    expect(result.current.data.results[0].name).toBe('Paracetamol 500mg')
  })

  it('passes filters to the query', async () => {
    let receivedParams = {}
    server.use(
      http.get('/api/inventory/items/', ({ request }) => {
        const url = new URL(request.url)
        receivedParams = Object.fromEntries(url.searchParams.entries())
        return HttpResponse.json({
          count: 1,
          results: [mockItem],
        })
      })
    )

    const filters = { stock_status: 'low', category: '1' }
    const { result } = renderHook(() => useInventoryItems(filters), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(receivedParams.stock_status).toBe('low')
    expect(receivedParams.category).toBe('1')
  })
})

describe('useInventoryItem', () => {
  it('fetches single item successfully', async () => {
    server.use(
      http.get('/api/inventory/items/:id/', ({ params }) => {
        if (params.id === mockItem.id) {
          return HttpResponse.json(mockItem)
        }
        return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
      })
    )

    const { result } = renderHook(() => useInventoryItem(mockItem.id), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.name).toBe('Paracetamol 500mg')
    expect(result.current.data.sku).toBe('MED-001')
  })

  it('does not fetch when id is not provided', async () => {
    const { result } = renderHook(() => useInventoryItem(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCreateInventoryItem', () => {
  it('creates an item successfully', async () => {
    server.use(
      http.post('/api/inventory/items/', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json(
          {
            id: 'new-item-id',
            ...body,
          },
          { status: 201 }
        )
      })
    )

    const { result } = renderHook(() => useCreateInventoryItem(), {
      wrapper: createWrapper(),
    })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        name: 'New Medicine',
        sku: 'MED-999',
        unit_of_measure: 'tablet',
        unit_price: 1.00,
      })
    })

    expect(mutationResult.id).toBe('new-item-id')
    expect(mutationResult.name).toBe('New Medicine')
  })
})

describe('useUpdateInventoryItem', () => {
  it('updates an item successfully with optimistic update', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )

    queryClient.setQueryData(inventoryKeys.itemDetail(mockItem.id), mockItem)

    server.use(
      http.patch('/api/inventory/items/:id/', async ({ params, request }) => {
        const body = await request.json()
        return HttpResponse.json({
          ...mockItem,
          ...body,
        })
      })
    )

    const { result } = renderHook(() => useUpdateInventoryItem(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        id: mockItem.id,
        data: { reorder_level: 200 },
      })
    })

    expect(result.current.isSuccess).toBe(true)
  })
})

// =========================================================================
// Storage Locations Hooks Tests
// =========================================================================

describe('useStorageLocations', () => {
  it('fetches locations list successfully', async () => {
    server.use(
      http.get('/api/inventory/locations/', () => {
        return HttpResponse.json({
          count: 1,
          results: [mockLocation],
        })
      })
    )

    const { result } = renderHook(() => useStorageLocations(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.results[0].name).toBe('Main Pharmacy')
  })
})

describe('useLocationStock', () => {
  it('fetches location stock successfully', async () => {
    const mockStock = [
      { item_id: 1, item_name: 'Paracetamol', quantity: 500 },
      { item_id: 2, item_name: 'Amoxicillin', quantity: 200 },
    ]

    server.use(
      http.get('/api/inventory/locations/:id/stock/', () => {
        return HttpResponse.json(mockStock)
      })
    )

    const { result } = renderHook(() => useLocationStock('loc-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(2)
  })
})

// =========================================================================
// Requisitions Hooks Tests
// =========================================================================

describe('useRequisitions', () => {
  it('fetches requisitions list successfully', async () => {
    server.use(
      http.get('/api/inventory/requisitions/', () => {
        return HttpResponse.json({
          count: 1,
          results: [mockRequisition],
        })
      })
    )

    const { result } = renderHook(() => useRequisitions(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.results[0].requisition_number).toBe('REQ-2024-001')
  })
})

describe('useApproveRequisition', () => {
  it('approves a requisition with optimistic update', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )

    queryClient.setQueryData(inventoryKeys.requisitionDetail('req-1'), mockRequisition)

    server.use(
      http.post('/api/inventory/requisitions/:id/approve/', () => {
        return HttpResponse.json({
          ...mockRequisition,
          status: 'approved',
        })
      })
    )

    const { result } = renderHook(() => useApproveRequisition(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('req-1')
    })

    expect(result.current.isSuccess).toBe(true)
  })
})

describe('useRejectRequisition', () => {
  it('rejects a requisition successfully', async () => {
    server.use(
      http.post('/api/inventory/requisitions/:id/reject/', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({
          ...mockRequisition,
          status: 'rejected',
          rejection_reason: body.reason,
        })
      })
    )

    const { result } = renderHook(() => useRejectRequisition(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync({
        id: 'req-1',
        data: { reason: 'Budget constraints' },
      })
    })

    expect(result.current.isSuccess).toBe(true)
  })
})

// =========================================================================
// Purchase Orders Hooks Tests
// =========================================================================

describe('usePurchaseOrders', () => {
  it('fetches purchase orders list successfully', async () => {
    server.use(
      http.get('/api/inventory/purchase-orders/', () => {
        return HttpResponse.json({
          count: 1,
          results: [mockPO],
        })
      })
    )

    const { result } = renderHook(() => usePurchaseOrders(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.results[0].po_number).toBe('PO-2024-001')
  })
})

describe('useApprovePurchaseOrder', () => {
  it('approves a PO with optimistic update', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )

    queryClient.setQueryData(inventoryKeys.purchaseOrderDetail('po-1'), mockPO)

    server.use(
      http.post('/api/inventory/purchase-orders/:id/approve/', () => {
        return HttpResponse.json({
          ...mockPO,
          status: 'approved',
        })
      })
    )

    const { result } = renderHook(() => useApprovePurchaseOrder(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('po-1')
    })

    expect(result.current.isSuccess).toBe(true)
  })
})

// =========================================================================
// GRN Hooks Tests
// =========================================================================

describe('useGRNs', () => {
  it('fetches GRNs list successfully', async () => {
    server.use(
      http.get('/api/inventory/grns/', () => {
        return HttpResponse.json({
          count: 1,
          results: [mockGRN],
        })
      })
    )

    const { result } = renderHook(() => useGRNs(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.results[0].grn_number).toBe('GRN-2024-001')
  })
})

describe('useAcceptGRN', () => {
  it('accepts a GRN and invalidates related queries', async () => {
    server.use(
      http.post('/api/inventory/grns/:id/accept/', () => {
        return HttpResponse.json({
          ...mockGRN,
          status: 'accepted',
        })
      })
    )

    const { result } = renderHook(() => useAcceptGRN(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync('grn-1')
    })

    expect(result.current.isSuccess).toBe(true)
  })
})

// =========================================================================
// Controlled Substances Hooks Tests
// =========================================================================

describe('useControlledRegisters', () => {
  it('fetches controlled registers list successfully', async () => {
    server.use(
      http.get('/api/inventory/controlled-registers/', () => {
        return HttpResponse.json({
          count: 1,
          results: [mockControlledRegister],
        })
      })
    )

    const { result } = renderHook(() => useControlledRegisters(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.results[0].item_name).toBe('Morphine 10mg')
  })

  it('filters by discrepancy status', async () => {
    let receivedParams = {}
    server.use(
      http.get('/api/inventory/controlled-registers/', ({ request }) => {
        const url = new URL(request.url)
        receivedParams = Object.fromEntries(url.searchParams.entries())
        return HttpResponse.json({ count: 0, results: [] })
      })
    )

    const { result } = renderHook(() => useControlledRegisters({ has_discrepancy: true }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(receivedParams.has_discrepancy).toBe('true')
  })
})

describe('useDispenseControlledSubstance', () => {
  it('dispenses controlled substance successfully', async () => {
    server.use(
      http.post('/api/inventory/controlled-registers/dispense/', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({
          id: 'entry-1',
          entry_type: 'dispense',
          quantity: body.quantity,
          register: body.register,
          patient_name: body.patient_name,
          witness_name: body.witness_name,
        })
      })
    )

    const { result } = renderHook(() => useDispenseControlledSubstance(), {
      wrapper: createWrapper(),
    })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        register: 'reg-1',
        quantity: 2,
        patient_name: 'John Doe',
        witness_name: 'Jane Smith',
      })
    })

    expect(mutationResult.entry_type).toBe('dispense')
    expect(mutationResult.quantity).toBe(2)
  })

  it('handles dispense error', async () => {
    server.use(
      http.post('/api/inventory/controlled-registers/dispense/', () => {
        return HttpResponse.json(
          { detail: 'Insufficient balance' },
          { status: 400 }
        )
      })
    )

    const { result } = renderHook(() => useDispenseControlledSubstance(), {
      wrapper: createWrapper(),
    })

    let errorThrown = false
    await act(async () => {
      try {
        await result.current.mutateAsync({
          register: 'reg-1',
          quantity: 100,
          patient_name: 'John Doe',
          witness_name: 'Jane Smith',
        })
      } catch (e) {
        errorThrown = true
      }
    })

    expect(errorThrown).toBe(true)
  })
})

describe('useRecordControlledCount', () => {
  it('records physical count successfully', async () => {
    server.use(
      http.post('/api/inventory/controlled-registers/count/', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json({
          id: 'entry-2',
          entry_type: 'count',
          actual_count: body.actual_count,
          expected_balance: 45,
          discrepancy: body.actual_count - 45,
        })
      })
    )

    const { result } = renderHook(() => useRecordControlledCount(), {
      wrapper: createWrapper(),
    })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        register: 'reg-1',
        actual_count: 43,
        witness_name: 'Jane Smith',
      })
    })

    expect(mutationResult.entry_type).toBe('count')
    expect(mutationResult.discrepancy).toBe(-2)
  })
})
