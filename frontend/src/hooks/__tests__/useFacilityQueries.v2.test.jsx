import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFacilities } from '../useFacilityQueries'
import { facilitiesApi } from '@/shared/api/facilities'

vi.mock('@/shared/api/facilities', () => ({
  facilitiesApi: {
    listFacilities: vi.fn(),
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useFacilityQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    facilitiesApi.listFacilities.mockResolvedValue([])
  })

  it('threads React Query AbortSignal into facility metadata reads', async () => {
    const { result } = renderHook(() => useFacilities({ includeInactive: true }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(facilitiesApi.listFacilities).toHaveBeenCalledWith({
      includeInactive: true,
      signal: expect.any(AbortSignal),
    })
  })
})
