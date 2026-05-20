import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useClinicalUnit,
  useClinicalUnits,
  useClinicalUnitsTree,
  useClinic,
  useClinicSchedules,
  useClinics,
  useAssignmentTypes,
  useCrossCoverageSchedules,
  useDepartmentDutyTypes,
  useDepartmentRosterPatterns,
  useDepartmentRosterPlans,
  useDepartmentStations,
  useDutyRoster,
  useDutyRosterEntry,
  useDutyRosterTemplate,
  useDutyRosterTemplates,
  useLeadershipAssignments,
  useLeadershipRole,
  useLeadershipRoles,
  useOnDuty,
  useRosterEntries,
  useRosterEntry,
  useRosterOnDutyAll,
  useRosterOnDutyDepartment,
  useRosterOverrides,
  useRosterPatternSlots,
  useRotationRule,
  useRotationRules,
  useShiftDefinition,
  useShiftDefinitions,
  useStaffAssignments,
  useTeamRosterEntries,
  useTeamRosterPlans,
  useUnitAncestors,
  useUnitChildren,
  useUnitLeaders,
  useUnitMembers,
  useUnitMembersCounts,
  useUnitMembersList,
  useUnitStaff,
  useUnitStaffCounts,
  useUnitType,
  useUnitTypes,
  useUnitWards,
  useValidationRule,
  useValidationRuleTemplates,
  useValidationRules,
  useWardAllocations,
} from '../useOrganization';
import {
  assignmentTypesApi,
  clinicalUnitsApi,
  clinicSchedulesApi,
  clinicsApi,
  crossCoverageApi,
  departmentDutyTypesApi,
  departmentRosterPatternsApi,
  departmentRosterPlansApi,
  departmentStationsApi,
  dutyRosterApi,
  dutyRosterTemplatesApi,
  leadershipApi,
  leadershipRolesApi,
  rosterEntriesApi,
  rosterOverridesApi,
  rosterPatternSlotsApi,
  rotationRulesApi,
  shiftDefinitionsApi,
  staffAssignmentsApi,
  teamRosterEntriesApi,
  teamRosterPlansApi,
  unitTypesApi,
  unitMembersApi,
  validationRulesApi,
  wardAllocationsApi,
} from '@/features/admin/api';

vi.mock('@/features/admin/api', () => ({
  unitTypesApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  leadershipRolesApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  assignmentTypesApi: {
    list: vi.fn(),
  },
  clinicalUnitsApi: {
    list: vi.fn(),
    tree: vi.fn(),
    get: vi.fn(),
    children: vi.fn(),
    ancestors: vi.fn(),
    leaders: vi.fn(),
    staffPaginated: vi.fn(),
    staffCounts: vi.fn(),
    membersPaginated: vi.fn(),
    membersCounts: vi.fn(),
    wards: vi.fn(),
  },
  leadershipApi: {
    list: vi.fn(),
  },
  staffAssignmentsApi: {
    list: vi.fn(),
  },
  unitMembersApi: {
    list: vi.fn(),
  },
  crossCoverageApi: {
    list: vi.fn(),
  },
  wardAllocationsApi: {
    list: vi.fn(),
  },
  shiftDefinitionsApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  dutyRosterTemplatesApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  dutyRosterApi: {
    list: vi.fn(),
    get: vi.fn(),
    onDuty: vi.fn(),
  },
  departmentDutyTypesApi: {
    list: vi.fn(),
  },
  departmentStationsApi: {
    list: vi.fn(),
  },
  departmentRosterPlansApi: {
    list: vi.fn(),
  },
  departmentRosterPatternsApi: {
    list: vi.fn(),
  },
  rosterPatternSlotsApi: {
    list: vi.fn(),
  },
  rosterOverridesApi: {
    list: vi.fn(),
  },
  teamRosterPlansApi: {
    list: vi.fn(),
  },
  teamRosterEntriesApi: {
    list: vi.fn(),
  },
  clinicsApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  clinicSchedulesApi: {
    list: vi.fn(),
  },
  rotationRulesApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  rosterEntriesApi: {
    list: vi.fn(),
    get: vi.fn(),
    onDutyDepartment: vi.fn(),
    onDutyAll: vi.fn(),
  },
  validationRulesApi: {
    list: vi.fn(),
    get: vi.fn(),
    templates: vi.fn(),
  },
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
      clinicalUnitsApi.leaders,
      clinicalUnitsApi.staffPaginated,
      clinicalUnitsApi.staffCounts,
      clinicalUnitsApi.membersPaginated,
      clinicalUnitsApi.membersCounts,
      clinicalUnitsApi.wards,
      leadershipRolesApi.list,
      leadershipRolesApi.get,
      assignmentTypesApi.list,
      leadershipApi.list,
      staffAssignmentsApi.list,
      unitMembersApi.list,
      crossCoverageApi.list,
      wardAllocationsApi.list,
      shiftDefinitionsApi.list,
      shiftDefinitionsApi.get,
      dutyRosterTemplatesApi.list,
      dutyRosterTemplatesApi.get,
      dutyRosterApi.list,
      dutyRosterApi.get,
      dutyRosterApi.onDuty,
      departmentDutyTypesApi.list,
      departmentStationsApi.list,
      departmentRosterPlansApi.list,
      departmentRosterPatternsApi.list,
      rosterPatternSlotsApi.list,
      rosterOverridesApi.list,
      teamRosterPlansApi.list,
      teamRosterEntriesApi.list,
      clinicsApi.list,
      clinicsApi.get,
      clinicSchedulesApi.list,
      rotationRulesApi.list,
      rotationRulesApi.get,
      rosterEntriesApi.list,
      rosterEntriesApi.get,
      rosterEntriesApi.onDutyDepartment,
      rosterEntriesApi.onDutyAll,
      validationRulesApi.list,
      validationRulesApi.get,
      validationRulesApi.templates,
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

  it('threads React Query AbortSignal into ancillary organization reads', async () => {
    await expectSuccessfulHook(() => useLeadershipRoles({ is_active: true }));
    await expectSuccessfulHook(() => useLeadershipRole('role-1'));
    await expectSuccessfulHook(() => useAssignmentTypes({ unit_type: 'ward' }));
    await expectSuccessfulHook(() => useUnitLeaders('unit-1'));
    await expectSuccessfulHook(() => useLeadershipAssignments({ unit: 'unit-1' }));
    await expectSuccessfulHook(() => useStaffAssignments({ unit: 'unit-1' }));
    await expectSuccessfulHook(() => useUnitMembersList({ unit: 'unit-1' }));
    await expectSuccessfulHook(() => useCrossCoverageSchedules({ unit: 'unit-1' }));
    await expectSuccessfulHook(() => useWardAllocations({ unit: 'unit-1' }));

    expect(leadershipRolesApi.list).toHaveBeenCalledWith(
      { is_active: true },
      { signal: expect.any(AbortSignal) },
    );
    expect(leadershipRolesApi.get).toHaveBeenCalledWith('role-1', {
      signal: expect.any(AbortSignal),
    });
    expect(assignmentTypesApi.list).toHaveBeenCalledWith(
      { unit_type: 'ward' },
      { signal: expect.any(AbortSignal) },
    );
    expect(clinicalUnitsApi.leaders).toHaveBeenCalledWith('unit-1', {
      signal: expect.any(AbortSignal),
    });
    expect(leadershipApi.list).toHaveBeenCalledWith(
      { unit: 'unit-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(staffAssignmentsApi.list).toHaveBeenCalledWith(
      { unit: 'unit-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(unitMembersApi.list).toHaveBeenCalledWith(
      { unit: 'unit-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(crossCoverageApi.list).toHaveBeenCalledWith(
      { unit: 'unit-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(wardAllocationsApi.list).toHaveBeenCalledWith(
      { unit: 'unit-1' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('threads React Query AbortSignal into paginated unit assignment reads', async () => {
    await expectSuccessfulHook(() => useUnitStaff('unit-1', { q: 'nurse' }));
    await expectSuccessfulHook(() => useUnitStaffCounts('unit-1', { q: 'nurse' }));
    await expectSuccessfulHook(() => useUnitMembers('unit-1', { q: 'physician' }));
    await expectSuccessfulHook(() => useUnitMembersCounts('unit-1', { q: 'physician' }));

    expect(clinicalUnitsApi.staffPaginated).toHaveBeenCalledWith(
      'unit-1',
      { page: 1, q: 'nurse' },
      { signal: expect.any(AbortSignal) },
    );
    expect(clinicalUnitsApi.staffCounts).toHaveBeenCalledWith(
      'unit-1',
      { include_descendants: undefined, q: 'nurse' },
      { signal: expect.any(AbortSignal) },
    );
    expect(clinicalUnitsApi.membersPaginated).toHaveBeenCalledWith(
      'unit-1',
      { page: 1, q: 'physician' },
      { signal: expect.any(AbortSignal) },
    );
    expect(clinicalUnitsApi.membersCounts).toHaveBeenCalledWith(
      'unit-1',
      { include_descendants: undefined, q: 'physician' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('threads React Query AbortSignal into roster organization reads', async () => {
    await expectSuccessfulHook(() => useShiftDefinitions({ department: 'ward' }));
    await expectSuccessfulHook(() => useShiftDefinition('shift-1'));
    await expectSuccessfulHook(() => useDutyRosterTemplates({ department: 'ward' }));
    await expectSuccessfulHook(() => useDutyRosterTemplate('template-1'));
    await expectSuccessfulHook(() => useDepartmentDutyTypes({ department: 'ward' }));
    await expectSuccessfulHook(() => useDepartmentStations({ department: 'ward' }));
    await expectSuccessfulHook(() => useDepartmentRosterPlans({ department: 'ward' }));
    await expectSuccessfulHook(() => useDepartmentRosterPatterns({ plan: 'plan-1' }));
    await expectSuccessfulHook(() => useRosterPatternSlots({ pattern: 'pattern-1' }));
    await expectSuccessfulHook(() => useRosterOverrides({ roster: 'roster-1' }));
    await expectSuccessfulHook(() => useTeamRosterPlans({ team: 'team-1' }));
    await expectSuccessfulHook(() => useTeamRosterEntries({ team: 'team-1' }));
    await expectSuccessfulHook(() => useDutyRoster({ unit: 'unit-1' }));
    await expectSuccessfulHook(() => useDutyRosterEntry('entry-1'));
    await expectSuccessfulHook(() => useOnDuty({ unit_id: 'unit-1' }));

    expect(shiftDefinitionsApi.list).toHaveBeenCalledWith(
      { department: 'ward' },
      { signal: expect.any(AbortSignal) },
    );
    expect(shiftDefinitionsApi.get).toHaveBeenCalledWith('shift-1', {
      signal: expect.any(AbortSignal),
    });
    expect(dutyRosterTemplatesApi.list).toHaveBeenCalledWith(
      { department: 'ward' },
      { signal: expect.any(AbortSignal) },
    );
    expect(dutyRosterTemplatesApi.get).toHaveBeenCalledWith('template-1', {
      signal: expect.any(AbortSignal),
    });
    expect(departmentDutyTypesApi.list).toHaveBeenCalledWith(
      { department: 'ward' },
      { signal: expect.any(AbortSignal) },
    );
    expect(departmentStationsApi.list).toHaveBeenCalledWith(
      { department: 'ward' },
      { signal: expect.any(AbortSignal) },
    );
    expect(departmentRosterPlansApi.list).toHaveBeenCalledWith(
      { department: 'ward' },
      { signal: expect.any(AbortSignal) },
    );
    expect(departmentRosterPatternsApi.list).toHaveBeenCalledWith(
      { plan: 'plan-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(rosterPatternSlotsApi.list).toHaveBeenCalledWith(
      { pattern: 'pattern-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(rosterOverridesApi.list).toHaveBeenCalledWith(
      { roster: 'roster-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(teamRosterPlansApi.list).toHaveBeenCalledWith(
      { team: 'team-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(teamRosterEntriesApi.list).toHaveBeenCalledWith(
      { team: 'team-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(dutyRosterApi.list).toHaveBeenCalledWith(
      { unit: 'unit-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(dutyRosterApi.get).toHaveBeenCalledWith('entry-1', {
      signal: expect.any(AbortSignal),
    });
    expect(dutyRosterApi.onDuty).toHaveBeenCalledWith(
      { unit_id: 'unit-1' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('threads React Query AbortSignal into clinic and validation roster reads', async () => {
    await expectSuccessfulHook(() => useClinicSchedules({ clinic: 'clinic-1' }));
    await expectSuccessfulHook(() => useRotationRules('dept-1', { active: true }));
    await expectSuccessfulHook(() => useRotationRule('rotation-1'));
    await expectSuccessfulHook(() => useRosterEntries('dept-1', { start: '2026-05-13' }));
    await expectSuccessfulHook(() => useRosterEntry('roster-entry-1'));
    await expectSuccessfulHook(() => useRosterOnDutyDepartment('dept-1', { date: '2026-05-13' }));
    await expectSuccessfulHook(() => useRosterOnDutyAll({ date: '2026-05-13' }));
    await expectSuccessfulHook(() => useValidationRules('dept-1', { active: true }));
    await expectSuccessfulHook(() => useValidationRule('validation-1'));
    await expectSuccessfulHook(() => useValidationRuleTemplates());

    expect(clinicSchedulesApi.list).toHaveBeenCalledWith(
      { clinic: 'clinic-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(rotationRulesApi.list).toHaveBeenCalledWith(
      'dept-1',
      { active: true },
      { signal: expect.any(AbortSignal) },
    );
    expect(rotationRulesApi.get).toHaveBeenCalledWith('rotation-1', {
      signal: expect.any(AbortSignal),
    });
    expect(rosterEntriesApi.list).toHaveBeenCalledWith(
      'dept-1',
      { start: '2026-05-13' },
      { signal: expect.any(AbortSignal) },
    );
    expect(rosterEntriesApi.get).toHaveBeenCalledWith('roster-entry-1', {
      signal: expect.any(AbortSignal),
    });
    expect(rosterEntriesApi.onDutyDepartment).toHaveBeenCalledWith(
      'dept-1',
      { date: '2026-05-13' },
      { signal: expect.any(AbortSignal) },
    );
    expect(rosterEntriesApi.onDutyAll).toHaveBeenCalledWith(
      { date: '2026-05-13' },
      { signal: expect.any(AbortSignal) },
    );
    expect(validationRulesApi.list).toHaveBeenCalledWith(
      'dept-1',
      { active: true },
      { signal: expect.any(AbortSignal) },
    );
    expect(validationRulesApi.get).toHaveBeenCalledWith('validation-1', {
      signal: expect.any(AbortSignal),
    });
    expect(validationRulesApi.templates).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
  });
});
