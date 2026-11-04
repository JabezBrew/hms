import { AuthContext } from '@/lib/auth/AuthContext'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFeatureEntitlements, useSystemCapabilities } from '../useSystemQueries'
import { systemApi } from '@/shared/api/system'

vi.mock('@/shared/api/system', () => ({
  systemApi: {
    getDeploymentCapabilities: vi.fn(),
    getFeatureEntitlements: vi.fn(),
  },
}))

const runtime = window.__HMS_RUNTIME_CONFIG__
const systemReader = { id: '27272727-0000-4000-8000-000000000110', adminAccess: { capabilities: ['system.deployment_capabilities.view'] }, accessContext: { facility_id: '27272727-0000-4000-8000-000000000111', active_profile: 'hospital' } }
afterEach(() => { window.__HMS_RUNTIME_CONFIG__ = runtime })

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
    return <AuthContext.Provider value={{ user: systemReader }}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></AuthContext.Provider>
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
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }
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
