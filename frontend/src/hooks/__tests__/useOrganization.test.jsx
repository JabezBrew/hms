import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockPatch = vi.fn()

vi.mock('@/features/admin/api', () => ({
  unitTypesApi: {},
  leadershipRolesApi: {},
  assignmentTypesApi: {},
  clinicalUnitsApi: {
    patch: (...args) => mockPatch(...args),
  },
  leadershipApi: {},
  staffAssignmentsApi: {},
  unitMembersApi: {},
  crossCoverageApi: {},
  wardAllocationsApi: {},
  shiftDefinitionsApi: {},
  dutyRosterTemplatesApi: {},
  dutyRosterApi: {},
  departmentDutyTypesApi: {},
  departmentStationsApi: {},
  departmentRosterPlansApi: {},
  departmentRosterPatternsApi: {},
  rosterPatternSlotsApi: {},
  rosterOverridesApi: {},
  teamRosterPlansApi: {},
  teamRosterEntriesApi: {},
  clinicsApi: {},
  clinicSchedulesApi: {},
  rotationRulesApi: {},
  rosterEntriesApi: {},
  validationRulesApi: {},
}))

import { organizationKeys, useUpdateClinicalUnit } from '../useOrganization'

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

function createWrapper(queryClient) {
  return function Wrapper({ children }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

describe('useUpdateClinicalUnit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses PATCH for partial unit edits and invalidates unit queries', async () => {
    const queryClient = createTestQueryClient()
    const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockPatch.mockResolvedValue({ id: 'unit-1', name: 'Medicine' })

    const { result } = renderHook(() => useUpdateClinicalUnit(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        id: 'unit-1',
        data: { name: 'Medicine' },
      })
    })

    expect(mockPatch).toHaveBeenCalledWith('unit-1', { name: 'Medicine' })

    await waitFor(() => {
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: organizationKeys.unit('unit-1'),
      })
      expect(invalidateQueriesSpy).toHaveBeenCalledWith({
        queryKey: organizationKeys.units(),
      })
    })
  })
})
