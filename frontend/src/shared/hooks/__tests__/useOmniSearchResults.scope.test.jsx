import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOmniSearchResults } from '../useOmniSearchResults'

const mocks = vi.hoisted(() => ({ auth: {}, search: vi.fn() }))
vi.mock('@/lib/auth', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/shared/api/omniSearch', () => ({ omniSearchApi: { search: mocks.search } }))

function session(permissionVersion = 1) {
  return {
    facilityCode: 'SYNTHETIC',
    user: {
      id: 'synthetic-user',
      accessContext: {
        facility_id: 'synthetic-facility',
        active_profile: 'hospital',
        permission_version: permissionVersion,
        permissions: permissionVersion === 1 ? ['patient.demographics.view'] : [],
      },
    },
  }
}

describe('Omni Search authorization scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth = session()
  })

  it('removes previously visible results when permissions change and preserves cancellation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    mocks.search.mockResolvedValueOnce({ groups: { patients: [{ id: 'synthetic-result' }] } })
    const { result, rerender, unmount } = renderHook(() => useOmniSearchResults({
      open: true,
      facilityCode: 'SYNTHETIC',
      q: 'sensitive synthetic query',
    }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data.groups.patients).toHaveLength(1)
    expect(mocks.search.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal)
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.queryKey)))
      .not.toContain('sensitive synthetic query')

    mocks.auth = session(2)
    mocks.search.mockRejectedValueOnce(new Error('access denied'))
    rerender()
    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(mocks.search).toHaveBeenCalledTimes(2)
    unmount()
    queryClient.clear()
  })
})
