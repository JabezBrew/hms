/**
 * Tests for usePatientQueries hooks.
 *
 * Tests cover:
 * - Query hooks (usePatients, usePatient, usePatientHistory, useRecentPatients)
 * - Mutation hooks (useCreatePatient, useUpdatePatient, useDeletePatient)
 * - Query key generation
 * - Error handling
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../tests/mocks/server'
import {
  patientKeys,
  usePatients,
  usePatient,
  useCreatePatient,
  useUpdatePatient,
  useDeletePatient,
  usePatientHistory,
  useRecentPatients,
  usePatientValidationRules,
} from '../usePatientQueries'

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

// Mock patient data
const mockPatient = {
  id: 'test-patient-id',
  user: {
    id: 'test-user-id',
    first_name: 'John',
    last_name: 'Doe',
    email: 'john@example.com',
  },
  medical_record_number: 'MRN123456',
  blood_group: 'O+',
  allergies: 'Penicillin',
}

const mockPatientList = [
  mockPatient,
  {
    id: 'test-patient-id-2',
    user: {
      id: 'test-user-id-2',
      first_name: 'Jane',
      last_name: 'Smith',
      email: 'jane@example.com',
    },
    medical_record_number: 'MRN654321',
    blood_group: 'A+',
    allergies: null,
  },
]

describe('patientKeys', () => {
  it('generates correct query keys', () => {
    expect(patientKeys.all).toEqual(['patients'])
    expect(patientKeys.lists()).toEqual(['patients', 'list'])
    expect(patientKeys.list({ page: 1 })).toEqual(['patients', 'list', { filters: { page: 1 } }])
    expect(patientKeys.details()).toEqual(['patients', 'detail'])
    expect(patientKeys.detail('123')).toEqual(['patients', 'detail', '123'])
    expect(patientKeys.history('123')).toEqual(['patients', 'history', '123'])
    expect(patientKeys.recent()).toEqual(['patients', 'recent'])
    expect(patientKeys.validation()).toEqual(['patients', 'validation'])
  })
})

describe('usePatients', () => {
  it('fetches patients list successfully', async () => {
    server.use(
      http.get('/api/users/patients/', () => {
        return HttpResponse.json({
          count: mockPatientList.length,
          next: null,
          previous: null,
          results: mockPatientList,
        })
      })
    )

    const { result } = renderHook(() => usePatients(), {
      wrapper: createWrapper(),
    })

    // Initially loading
    expect(result.current.isLoading).toBe(true)

    // Wait for data
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    // Should have data (apiClient.get returns the results array)
    expect(result.current.data).toHaveLength(2)
  })

  it('handles empty patient list', async () => {
    server.use(
      http.get('/api/users/patients/', () => {
        return HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        })
      })
    )

    const { result } = renderHook(() => usePatients(), {
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
      http.get('/api/users/patients/', ({ request }) => {
        const url = new URL(request.url)
        receivedParams = Object.fromEntries(url.searchParams.entries())
        return HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [mockPatient],
        })
      })
    )

    const filters = { page: 2, page_size: 20 }
    const { result } = renderHook(() => usePatients(filters), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(receivedParams.page).toBe('2')
    expect(receivedParams.page_size).toBe('20')
  })
})

describe('usePatient', () => {
  it('fetches single patient successfully', async () => {
    server.use(
      http.get('/api/patients/:id/get_patient/', ({ params }) => {
        if (params.id === mockPatient.id) {
          return HttpResponse.json(mockPatient)
        }
        return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
      })
    )

    const { result } = renderHook(() => usePatient(mockPatient.id), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.id).toBe(mockPatient.id)
    expect(result.current.data.user.first_name).toBe('John')
  })

  it('does not fetch when id is not provided', async () => {
    const { result } = renderHook(() => usePatient(null), {
      wrapper: createWrapper(),
    })

    // Should not be loading when disabled
    expect(result.current.isLoading).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('handles 404 error', async () => {
    server.use(
      http.get('/api/patients/:id/get_patient/', () => {
        return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
      })
    )

    const { result } = renderHook(() => usePatient('nonexistent-id'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
  })
})

describe('useCreatePatient', () => {
  it('creates a patient successfully', async () => {
    server.use(
      http.post('/api/patients/', async ({ request }) => {
        const body = await request.json()
        return HttpResponse.json(
          {
            id: 'new-patient-id',
            user: {
              first_name: body.first_name,
              last_name: body.last_name,
              email: body.email,
            },
            medical_record_number: 'MRN999999',
          },
          { status: 201 }
        )
      })
    )

    const { result } = renderHook(() => useCreatePatient(), {
      wrapper: createWrapper(),
    })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        first_name: 'New',
        last_name: 'Patient',
        email: 'new@example.com',
      })
    })

    // Check the returned data from the mutation
    expect(mutationResult.id).toBe('new-patient-id')
    expect(mutationResult.medical_record_number).toBe('MRN999999')
  })

  it('handles creation error', async () => {
    server.use(
      http.post('/api/patients/', () => {
        return HttpResponse.json(
          { detail: 'Validation error' },
          { status: 400 }
        )
      })
    )

    const { result } = renderHook(() => useCreatePatient(), {
      wrapper: createWrapper(),
    })

    let errorThrown = false
    await act(async () => {
      try {
        await result.current.mutateAsync({
          first_name: '',
          last_name: '',
        })
      } catch (e) {
        errorThrown = true
      }
    })

    expect(errorThrown).toBe(true)
  })
})

describe('useUpdatePatient', () => {
  it('updates a patient successfully', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )

    // Pre-populate the cache with existing patient data
    queryClient.setQueryData(patientKeys.detail(mockPatient.id), mockPatient)

    server.use(
      http.put('/api/patients/:id/', async ({ params, request }) => {
        const body = await request.json()
        return HttpResponse.json({
          ...mockPatient,
          id: params.id,
          ...body,
        })
      })
    )

    const { result } = renderHook(() => useUpdatePatient(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        id: mockPatient.id,
        data: { allergies: 'None' },
      })
    })

    expect(result.current.isSuccess).toBe(true)
  })

  it('returns updated data from mutation', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )

    // Pre-populate the cache
    queryClient.setQueryData(patientKeys.detail(mockPatient.id), mockPatient)

    server.use(
      http.put('/api/patients/:id/', async ({ params, request }) => {
        const body = await request.json()
        return HttpResponse.json({
          ...mockPatient,
          id: params.id,
          ...body,
        })
      })
    )

    const { result } = renderHook(() => useUpdatePatient(), { wrapper })

    let mutationResult
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        id: mockPatient.id,
        data: { allergies: 'Updated allergies' },
      })
    })

    // Check the returned data from the mutation
    expect(mutationResult.allergies).toBe('Updated allergies')
    expect(mutationResult.id).toBe(mockPatient.id)
  })

  it('handles update error', async () => {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )

    // Pre-populate the cache with original data
    queryClient.setQueryData(patientKeys.detail(mockPatient.id), { ...mockPatient })

    server.use(
      http.put('/api/patients/:id/', () => {
        return HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      })
    )

    const { result } = renderHook(() => useUpdatePatient(), { wrapper })

    let errorThrown = false
    await act(async () => {
      try {
        await result.current.mutateAsync({
          id: mockPatient.id,
          data: { allergies: 'Should fail' },
        })
      } catch (e) {
        errorThrown = true
      }
    })

    expect(errorThrown).toBe(true)
  })
})

describe('useDeletePatient', () => {
  it('deletes a patient successfully', async () => {
    server.use(
      http.delete('/api/patients/:id/delete_patient/', () => {
        return HttpResponse.json({ detail: 'Deleted successfully' })
      })
    )

    const { result } = renderHook(() => useDeletePatient(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync(mockPatient.id)
    })

    expect(result.current.isSuccess).toBe(true)
  })
})

describe('usePatientHistory', () => {
  it('fetches patient history successfully', async () => {
    const mockHistory = [
      { type: 'encounter', date: '2024-01-01', description: 'Checkup' },
      { type: 'lab_result', date: '2024-01-02', description: 'Blood test' },
    ]

    server.use(
      http.get('/api/patients/:id/history/', ({ params }) => {
        if (params.id === mockPatient.id) {
          return HttpResponse.json(mockHistory)
        }
        return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
      })
    )

    const { result } = renderHook(() => usePatientHistory(mockPatient.id), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data[0].type).toBe('encounter')
  })

  it('does not fetch when id is not provided', async () => {
    const { result } = renderHook(() => usePatientHistory(null), {
      wrapper: createWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useRecentPatients', () => {
  it('fetches recent patients successfully', async () => {
    server.use(
      http.get('/api/patients/recent/', () => {
        return HttpResponse.json(mockPatientList)
      })
    )

    const { result } = renderHook(() => useRecentPatients(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(2)
  })
})

describe('usePatientValidationRules', () => {
  it('fetches validation rules successfully', async () => {
    const mockRules = {
      required_fields: ['first_name', 'last_name'],
      optional_fields: ['blood_group'],
    }

    server.use(
      http.get('/api/patients/validation-rules/', () => {
        return HttpResponse.json(mockRules)
      })
    )

    const { result } = renderHook(() => usePatientValidationRules(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data.required_fields).toContain('first_name')
  })
})
