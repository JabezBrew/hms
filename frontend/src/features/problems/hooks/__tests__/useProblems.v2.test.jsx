import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  usePatientProblems,
  useProblem,
  useProblemLinks,
  useSearchProblemCodes,
} from '../index'
import { problemsApi } from '../../api'

vi.mock('../../api', () => ({
  problemsApi: {
    listForPatient: vi.fn(),
    detail: vi.fn(),
    searchCodes: vi.fn(),
    listLinks: vi.fn(),
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

describe('useProblems Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.values(problemsApi).forEach((mockFn) => {
      mockFn.mockResolvedValue([])
    })
  })

  it('threads React Query AbortSignal into supported problem reads', async () => {
    await expectSuccessfulHook(() => usePatientProblems('patient-1', { includeResolved: true }))
    await expectSuccessfulHook(() => useProblem('problem-1'))
    await expectSuccessfulHook(() => useSearchProblemCodes('asthma', { quickPicksOnly: true }))
    await expectSuccessfulHook(() => useProblemLinks({ patient: 'patient-1' }))

    expect(problemsApi.listForPatient).toHaveBeenCalledWith(
      'patient-1',
      { include_resolved: '1' },
      { signal: expect.any(AbortSignal) },
    )
    expect(problemsApi.detail).toHaveBeenCalledWith('problem-1', {
      signal: expect.any(AbortSignal),
    })
    expect(problemsApi.searchCodes).toHaveBeenCalledWith(
      'asthma',
      { quick_picks_only: '1' },
      { signal: expect.any(AbortSignal) },
    )
    expect(problemsApi.listLinks).toHaveBeenCalledWith(
      { patient: 'patient-1' },
      { signal: expect.any(AbortSignal) },
    )
  })
})
