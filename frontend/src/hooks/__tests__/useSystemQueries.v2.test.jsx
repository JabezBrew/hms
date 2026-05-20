import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFeatureEntitlements, useSystemCapabilities } from '../useSystemQueries'
import { systemApi } from '@/shared/api/system'

vi.mock('@/shared/api/system', () => ({
  systemApi: {
    getDeploymentCapabilities: vi.fn(),
    getFeatureEntitlements: vi.fn(),
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

async function expectSuccessfulHook(render) {
  const { result } = renderHook(render, { wrapper: createWrapper() })
  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true)
  })
}

describe('useSystemQueries Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    systemApi.getDeploymentCapabilities.mockResolvedValue({ features: {} })
    systemApi.getFeatureEntitlements.mockResolvedValue({ results: [] })
  })

  it('threads React Query AbortSignal into supported system reads', async () => {
    await expectSuccessfulHook(() => useSystemCapabilities())
    await expectSuccessfulHook(() => useFeatureEntitlements({ page_size: 50 }))

    expect(systemApi.getDeploymentCapabilities).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    })
    expect(systemApi.getFeatureEntitlements).toHaveBeenCalledWith(
      { page_size: 50 },
      { signal: expect.any(AbortSignal) },
    )
  })
})
