import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useClinicalUnit,
  useClinicalUnits,
  useClinicalUnitsTree,
  useClinic,
  useClinics,
  useUnitAncestors,
  useUnitChildren,
  useUnitType,
  useUnitTypes,
  useUnitWards,
} from '../useOrganization';
import {
  clinicalUnitsApi,
  clinicsApi,
  unitTypesApi,
} from '@/features/admin/api';

vi.mock('@/features/admin/api', () => ({
  unitTypesApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  leadershipRolesApi: {},
  assignmentTypesApi: {},
  clinicalUnitsApi: {
    list: vi.fn(),
    tree: vi.fn(),
    get: vi.fn(),
    children: vi.fn(),
    ancestors: vi.fn(),
    wards: vi.fn(),
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
  clinicsApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  clinicSchedulesApi: {},
  rotationRulesApi: {},
  rosterEntriesApi: {},
  validationRulesApi: {},
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

async function expectSuccessfulHook(render) {
  const { result } = renderHook(render, { wrapper: createWrapper() });
  await waitFor(() => {
    expect(result.current.isSuccess).toBe(true);
  });
}

describe('useOrganization Rust V2 behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    [
      unitTypesApi.list,
      unitTypesApi.get,
      clinicalUnitsApi.list,
      clinicalUnitsApi.tree,
      clinicalUnitsApi.get,
      clinicalUnitsApi.children,
      clinicalUnitsApi.ancestors,
      clinicalUnitsApi.wards,
      clinicsApi.list,
      clinicsApi.get,
    ].forEach((mockFn) => mockFn.mockResolvedValue([]));
  });

  it('threads React Query AbortSignal into supported V2 organization reads', async () => {
    await expectSuccessfulHook(() => useUnitTypes({ is_active: true }));
    await expectSuccessfulHook(() => useUnitType('department'));
    await expectSuccessfulHook(() => useClinicalUnits({ unit_type_code: 'ward' }));
    await expectSuccessfulHook(() => useClinicalUnitsTree());
    await expectSuccessfulHook(() => useClinicalUnit('unit-1'));
    await expectSuccessfulHook(() => useUnitChildren('unit-1'));
    await expectSuccessfulHook(() => useUnitAncestors('unit-1'));
    await expectSuccessfulHook(() => useUnitWards('unit-1'));
    await expectSuccessfulHook(() => useClinics({ is_active: true }));
    await expectSuccessfulHook(() => useClinic('clinic-1'));

    expect(unitTypesApi.list).toHaveBeenCalledWith(
      { is_active: true },
      { signal: expect.any(AbortSignal) },
    );
    expect(unitTypesApi.get).toHaveBeenCalledWith('department', {
      signal: expect.any(AbortSignal),
    });
    expect(clinicalUnitsApi.list).toHaveBeenCalledWith(
      { unit_type_code: 'ward' },
      { signal: expect.any(AbortSignal) },
    );
    expect(clinicalUnitsApi.tree).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(clinicalUnitsApi.get).toHaveBeenCalledWith('unit-1', {
      signal: expect.any(AbortSignal),
    });
    expect(clinicalUnitsApi.children).toHaveBeenCalledWith('unit-1', {}, {
      signal: expect.any(AbortSignal),
    });
    expect(clinicalUnitsApi.ancestors).toHaveBeenCalledWith('unit-1', {}, {
      signal: expect.any(AbortSignal),
    });
    expect(clinicalUnitsApi.wards).toHaveBeenCalledWith('unit-1', {
      signal: expect.any(AbortSignal),
    });
    expect(clinicsApi.list).toHaveBeenCalledWith(
      { is_active: true },
      { signal: expect.any(AbortSignal) },
    );
    expect(clinicsApi.get).toHaveBeenCalledWith('clinic-1', {
      signal: expect.any(AbortSignal),
    });
  });
});
