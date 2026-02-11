/**
 * Tests for useWardQueries hooks.
 *
 * Tests cover:
 * - Query hooks (useWards, useWard, useBeds, useWardBeds)
 * - Mutation hooks (useCreateWard, useUpdateWard, useDeleteWard)
 * - Query key generation
 */
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/mocks/server'
import {
  wardKeys,
  useWards,
  useWard,
  useCreateWard,
  useUpdateWard,
  useDeleteWard,
  useBeds,
  useWardBeds,
  useAdmissions,
} from '../useWardQueries'

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

// Mock ward data
const mockWard = {
  id: 'test-ward-id',
  name: 'General Ward A',
  ward_type: 'general',
  is_active: true,
  total_beds: 20,
  available_beds_count: 8,
}

const mockWardList = [
  mockWard,
  {
    id: 'test-ward-id-2',
    name: 'ICU',
    ward_type: 'icu',
    is_active: true,
    total_beds: 10,
    available_beds_count: 3,
  },
]

const mockBed = {
  id: 'test-bed-id',
  ward: mockWard.id,
  bed_number: 'B-1',
  bed_type: 'standard',
  status: 'available',
}

const mockBedList = [
  mockBed,
  {
    id: 'test-bed-id-2',
    ward: mockWard.id,
    bed_number: 'B-2',
    bed_type: 'standard',
    status: 'occupied',
  },
]

describe('wardKeys', () => {
  it('generates correct query keys', () => {
    expect(wardKeys.all).toEqual(['wards'])
    expect(wardKeys.lists()).toEqual(['wards', 'list'])
    expect(wardKeys.list({ is_active: true })).toEqual(['wards', 'list', { filters: { is_active: true } }])
    expect(wardKeys.details()).toEqual(['wards', 'detail'])
    expect(wardKeys.detail('123')).toEqual(['wards', 'detail', '123'])
    expect(wardKeys.beds()).toEqual(['wards', 'beds'])
    expect(wardKeys.bedsList({ ward: '123' })).toEqual(['wards', 'beds', 'list', { filters: { ward: '123' } }])
    expect(wardKeys.wardBeds('123', {})).toEqual(['wards', 'detail', '123', 'beds', { filters: {} }])
    expect(wardKeys.admissions()).toEqual(['wards', 'admissions'])
  })
})

describe('useWards', () => {
  it('fetches wards list successfully', async () => {
    server.use(
      http.get('/api/wards/wards/', () => {
        return HttpResponse.json({
          count: mockWardList.length,
          next: null,
          previous: null,
          results: mockWardList,
        })
      })
    )

    const { result } = renderHook(() => useWards(), {
      wrapper: createWrapper(),
    })

    // Initially loading
    expect(result.current.isLoading).toBe(true)

    // Wait for data
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].name).toBe('General Ward A')
  })

  it('handles empty ward list', async () => {
    server.use(
      http.get('/api/wards/wards/', () => {
        return HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        })
      })
    )

    const { result } = renderHook(() => useWards(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(0)
  })

  it('passes filters to the query', async () => {
    let receivedParams = {}
    server.use(
      http.get('/api/wards/wards/', ({ request }) => {
        const url = new URL(request.url)
        receivedParams = Object.fromEntries(url.searchParams.entries())
        return HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [mockWard],
        })
      })
    )

    const filters = { is_active: true, ward_type: 'general' }
    const { result } = renderHook(() => useWards(filters), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(receivedParams.is_active).toBe('true')
    expect(receivedParams.ward_type).toBe('general')
  })
})

describe('useWard', () => {
  it('fetches single ward successfully', async () => {
    server.use(
      http.get('/api/wards/wards/:id/', ({ params }) => {
        if (params.id === mockWard.id) {
          return HttpResponse.json(mockWard)
        }
        return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
      })
    )

    const { result } = renderHook(() => useWard(mockWard.id), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.id).toBe(mockWard.id)
    expect(result.current.data.name).toBe('General Ward A')
  })

  it('does not fetch when id is not provided', async () => {
    const { result } = renderHook(() => useWard(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useCreateWard', () => {
  it('creates a ward successfully', async () => {
    server.use(
      http.post('/api/wards/wards/', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json(
          {
            id: 'new-ward-id',
            name: body.name,
            ward_type: body.ward_type,
            is_active: true,
            total_beds: 0,
            available_beds_count: 0,
          },
          { status: 201 }
        )
      })
    )

    const { result } = renderHook(() => useCreateWard(), {
      wrapper: createWrapper(),
    })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        name: 'New Ward',
        ward_type: 'general',
      })
    })

    expect(mutationResult.id).toBe('new-ward-id')
    expect(mutationResult.name).toBe('New Ward')
  })
})

describe('useUpdateWard', () => {
  it('updates a ward successfully', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )

    // Pre-populate the cache
    queryClient.setQueryData(wardKeys.detail(mockWard.id), mockWard)

    server.use(
      http.put('/api/wards/wards/:id/', async ({ params, request }) => {
        const body = await request.json()
        return HttpResponse.json({
          ...mockWard,
          id: params.id,
          ...body,
        })
      })
    )

    const { result } = renderHook(() => useUpdateWard(), { wrapper })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        id: mockWard.id,
        data: { name: 'Updated Ward Name' },
      })
    })

    expect(mutationResult.name).toBe('Updated Ward Name')
  })
})

describe('useDeleteWard', () => {
  it('deletes a ward successfully', async () => {
    server.use(
      http.delete('/api/wards/wards/:id/', () => {
        return HttpResponse.json({ detail: 'Deleted successfully' })
      })
    )

    const { result } = renderHook(() => useDeleteWard(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync(mockWard.id)
    })

    // Mutation should complete without error
    expect(result.current.isError).toBe(false)
  })
})

describe('useBeds', () => {
  it('fetches beds list successfully', async () => {
    server.use(
      http.get('/api/wards/beds/', () => {
        return HttpResponse.json({
          count: mockBedList.length,
          next: null,
          previous: null,
          results: mockBedList,
        })
      })
    )

    const { result } = renderHook(() => useBeds(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].bed_number).toBe('B-1')
  })
})

describe('useWardBeds', () => {
  it('fetches beds for a specific ward', async () => {
    server.use(
      http.get('/api/wards/wards/:wardId/beds/', ({ params }) => {
        if (params.wardId === mockWard.id) {
          return HttpResponse.json({
            count: mockBedList.length,
            next: null,
            previous: null,
            results: mockBedList,
          })
        }
        return HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        })
      })
    )

    const { result } = renderHook(() => useWardBeds(mockWard.id), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(2)
  })

  it('does not fetch when wardId is not provided', async () => {
    const { result } = renderHook(() => useWardBeds(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useAdmissions', () => {
  it('fetches admissions list successfully', async () => {
    const mockAdmissions = [
      {
        id: 'admission-1',
        patient: 'patient-1',
        ward: mockWard.id,
        bed: mockBed.id,
        admission_type: 'emergency',
        status: 'active',
      },
    ]

    server.use(
      http.get('/api/wards/admissions/', () => {
        return HttpResponse.json({
          count: mockAdmissions.length,
          next: null,
          previous: null,
          results: mockAdmissions,
        })
      })
    )

    const { result } = renderHook(() => useAdmissions(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data[0].admission_type).toBe('emergency')
  })
})
