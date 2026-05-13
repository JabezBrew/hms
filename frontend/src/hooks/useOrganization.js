/**
 * React Query hooks for organization management.
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  unitTypesApi,
  leadershipRolesApi,
  assignmentTypesApi,
  clinicalUnitsApi,
  leadershipApi,
  staffAssignmentsApi,
  unitMembersApi,
  crossCoverageApi,
  wardAllocationsApi,
  shiftDefinitionsApi,
  dutyRosterTemplatesApi,
  dutyRosterApi,
  departmentDutyTypesApi,
  departmentStationsApi,
  departmentRosterPlansApi,
  departmentRosterPatternsApi,
  rosterPatternSlotsApi,
  rosterOverridesApi,
  teamRosterPlansApi,
  teamRosterEntriesApi,
  clinicsApi,
  clinicSchedulesApi,
  rotationRulesApi,
  rosterEntriesApi,
  validationRulesApi,
} from '@/features/admin/api';
import { usePaginatedQuery } from './usePaginatedQuery';
import { createKeyFactory } from '@/shared/lib/queryKeys';

// =============================================================================
// Query Keys
// =============================================================================

const organizationKeyFactory = createKeyFactory('organization');

export const organizationKeys = {
  all: organizationKeyFactory.all,

  // Unit Types
  unitTypes: () => [...organizationKeys.all, 'unit-types'],
  unitTypesList: (params) => [...organizationKeys.unitTypes(), 'list', params],
  unitType: (id) => [...organizationKeys.unitTypes(), id],

  // Leadership Roles
  leadershipRoles: () => [...organizationKeys.all, 'leadership-roles'],
  leadershipRolesList: (params) => [...organizationKeys.leadershipRoles(), 'list', params],
  leadershipRole: (id) => [...organizationKeys.leadershipRoles(), id],

  // Assignment Types
  assignmentTypes: () => [...organizationKeys.all, 'assignment-types'],
  assignmentTypesList: (params) => [...organizationKeys.assignmentTypes(), 'list', params],

  // Clinical Units
  units: () => [...organizationKeys.all, 'units'],
  unitsList: (params) => [...organizationKeys.units(), 'list', params],
  unitsTree: () => [...organizationKeys.units(), 'tree'],
  unit: (id) => [...organizationKeys.units(), id],
  unitChildren: (id) => [...organizationKeys.units(), id, 'children'],
  unitAncestors: (id) => [...organizationKeys.units(), id, 'ancestors'],
  unitDescendants: (id, params) => [...organizationKeys.units(), id, 'descendants', params],
  unitLeaders: (id) => [...organizationKeys.units(), id, 'leaders'],
  unitStaffBase: (id) => [...organizationKeys.units(), id, 'staff'],
  unitStaff: (id, params) => [...organizationKeys.units(), id, 'staff', params],
  unitStaffCountsBase: (id) => [...organizationKeys.units(), id, 'staff', 'counts'],
  unitStaffCounts: (id, params) => [...organizationKeys.units(), id, 'staff', 'counts', params],
  unitMembersBase: (id) => [...organizationKeys.units(), id, 'members'],
  unitMembers: (id, params) => [...organizationKeys.units(), id, 'members', params],
  unitMembersCountsBase: (id) => [...organizationKeys.units(), id, 'members', 'counts'],
  unitMembersCounts: (id, params) => [...organizationKeys.units(), id, 'members', 'counts', params],
  unitWards: (id) => [...organizationKeys.units(), id, 'wards'],
  unitCoverage: (id) => [...organizationKeys.units(), id, 'coverage'],

  // Leadership Assignments
  leadership: () => [...organizationKeys.all, 'leadership'],
  leadershipList: (params) => [...organizationKeys.leadership(), 'list', params],

  // Staff Assignments
  staffAssignments: () => [...organizationKeys.all, 'staff-assignments'],
  staffAssignmentsList: (params) => [...organizationKeys.staffAssignments(), 'list', params],

  // Ops Unit Members
  unitMembersList: (params) => [...organizationKeys.all, 'unit-members', 'list', params],

  // Cross Coverage
  crossCoverage: () => [...organizationKeys.all, 'cross-coverage'],
  crossCoverageList: (params) => [...organizationKeys.crossCoverage(), 'list', params],

  // Ward Allocations
  wardAllocations: () => [...organizationKeys.all, 'ward-allocations'],
  wardAllocationsList: (params) => [...organizationKeys.wardAllocations(), 'list', params],

  // Shift Definitions
  shiftDefinitions: () => [...organizationKeys.all, 'shift-definitions'],
  shiftDefinitionsList: (params) => [...organizationKeys.shiftDefinitions(), 'list', params],
  shiftDefinition: (id) => [...organizationKeys.shiftDefinitions(), id],

  // Duty Roster Templates
  dutyRosterTemplates: () => [...organizationKeys.all, 'duty-roster-templates'],
  dutyRosterTemplatesList: (params) => [...organizationKeys.dutyRosterTemplates(), 'list', params],
  dutyRosterTemplate: (id) => [...organizationKeys.dutyRosterTemplates(), id],

  // Duty Roster
  dutyRoster: () => [...organizationKeys.all, 'duty-roster'],
  dutyRosterList: (params) => [...organizationKeys.dutyRoster(), 'list', params],
  dutyRosterEntry: (id) => [...organizationKeys.dutyRoster(), id],
  onDuty: (params) => [...organizationKeys.dutyRoster(), 'on-duty', params],
  departmentDutyTypes: () => [...organizationKeys.all, 'department-duty-types'],
  departmentDutyTypesList: (params) => [...organizationKeys.departmentDutyTypes(), 'list', params],
  departmentDutyType: (id) => [...organizationKeys.departmentDutyTypes(), id],
  departmentStations: () => [...organizationKeys.all, 'department-stations'],
  departmentStationsList: (params) => [...organizationKeys.departmentStations(), 'list', params],
  departmentStation: (id) => [...organizationKeys.departmentStations(), id],
  departmentRosterPlans: () => [...organizationKeys.all, 'department-roster-plans'],
  departmentRosterPlansList: (params) => [...organizationKeys.departmentRosterPlans(), 'list', params],
  departmentRosterPlan: (id) => [...organizationKeys.departmentRosterPlans(), id],
  departmentRosterPatterns: () => [...organizationKeys.all, 'department-roster-patterns'],
  departmentRosterPatternsList: (params) => [...organizationKeys.departmentRosterPatterns(), 'list', params],
  departmentRosterPattern: (id) => [...organizationKeys.departmentRosterPatterns(), id],
  rosterPatternSlots: () => [...organizationKeys.all, 'department-roster-slots'],
  rosterPatternSlotsList: (params) => [...organizationKeys.rosterPatternSlots(), 'list', params],
  rosterPatternSlot: (id) => [...organizationKeys.rosterPatternSlots(), id],
  rosterOverrides: () => [...organizationKeys.all, 'department-roster-overrides'],
  rosterOverridesList: (params) => [...organizationKeys.rosterOverrides(), 'list', params],
  rosterOverride: (id) => [...organizationKeys.rosterOverrides(), id],
  teamRosterPlans: () => [...organizationKeys.all, 'team-roster-plans'],
  teamRosterPlansList: (params) => [...organizationKeys.teamRosterPlans(), 'list', params],
  teamRosterPlan: (id) => [...organizationKeys.teamRosterPlans(), id],
  teamRosterEntries: () => [...organizationKeys.all, 'team-roster-entries'],
  teamRosterEntriesList: (params) => [...organizationKeys.teamRosterEntries(), 'list', params],
  teamRosterEntry: (id) => [...organizationKeys.teamRosterEntries(), id],
  clinics: () => [...organizationKeys.all, 'clinics'],

  clinicsList: (params) => [...organizationKeys.clinics(), 'list', params],

  // Clinic Schedules
  clinicSchedules: () => [...organizationKeys.all, 'clinic-schedules'],
  clinicSchedulesList: (params) => [...organizationKeys.clinicSchedules(), 'list', params],

  // Rotation Rules (simplified roster system)
  rotationRules: () => [...organizationKeys.all, 'rotation-rules'],
  rotationRulesList: (departmentId, params) => [...organizationKeys.rotationRules(), departmentId, 'list', params],
  rotationRule: (id) => [...organizationKeys.rotationRules(), id],

  // Roster Entries (simplified roster system)
  rosterEntries: () => [...organizationKeys.all, 'roster-entries'],
  rosterEntriesList: (departmentId, params) => [...organizationKeys.rosterEntries(), departmentId, 'list', params],
  rosterEntry: (id) => [...organizationKeys.rosterEntries(), id],
  rosterOnDutyDepartment: (departmentId, params) => [...organizationKeys.rosterEntries(), departmentId, 'on-duty', params],
  rosterOnDutyAll: (params) => [...organizationKeys.rosterEntries(), 'on-duty-all', params],

  // Validation Rules
  validationRules: () => [...organizationKeys.all, 'validation-rules'],
  validationRulesList: (departmentId, params) => [...organizationKeys.validationRules(), departmentId, 'list', params],
  validationRule: (id) => [...organizationKeys.validationRules(), id],
  validationRuleTemplates: () => [...organizationKeys.validationRules(), 'templates'],
};

function getTreeNodes(treeQueryData) {
  if (!treeQueryData) {
    return [];
  }
  const raw = treeQueryData.data || treeQueryData;
  return Array.isArray(raw) ? raw : [];
}

function buildOrgTreeIndex(treeNodes) {
  const ancestorsById = new Map();

  const walk = (node, ancestors) => {
    const nextAncestors = [...ancestors, node.id];
    ancestorsById.set(node.id, nextAncestors);
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      walk(child, nextAncestors);
    }
  };

  for (const node of treeNodes) {
    walk(node, []);
  }

  return { ancestorsById };
}

function countAssignmentResults(pages) {
  if (!Array.isArray(pages)) {
    return 0;
  }
  return pages.reduce((total, page) => total + (page.results?.length || 0), 0);
}

function filterAssignmentPages(pages, unitId, ancestorsById) {
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages.map((page) => {
    const results = Array.isArray(page.results) ? page.results : [];
    const filtered = results.filter((item) => {
      const ancestors = ancestorsById.get(item.unit);
      if (!ancestors) {
        return item.unit === unitId;
      }
      return ancestors.includes(unitId);
    });
    if (filtered.length === results.length) {
      return page;
    }
    return { ...page, results: filtered };
  });
}

function findClosestCachedAncestorId(queryClient, ancestors, baseKey, querySuffix, hasData) {
  const hasCachedData = hasData || ((cached) => cached?.pages?.length);
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const candidateId = ancestors[i];
    const key = [...baseKey(candidateId), ...querySuffix];
    const cached = queryClient.getQueryData(key);
    if (hasCachedData(cached)) {
      return candidateId;
    }
  }
  return ancestors[ancestors.length - 1];
}

function normalizeCountsPayload(payload) {
  if (!payload) {
    return {};
  }
  if (
    payload.data &&
    typeof payload.data === 'object' &&
    !Array.isArray(payload.data)
  ) {
    return payload.data;
  }
  return payload;
}

function aggregateCountsByUnit(countsPayload, ancestorsById) {
  const aggregated = new Map();
  if (!countsPayload || typeof countsPayload !== 'object') {
    return aggregated;
  }
  for (const [unitId, countValue] of Object.entries(countsPayload)) {
    const count = Number(countValue) || 0;
    const ancestors = ancestorsById.get(unitId);
    if (!ancestors) {
      if (count) {
        aggregated.set(unitId, (aggregated.get(unitId) || 0) + count);
      }
      continue;
    }
    for (const ancestorId of ancestors) {
      aggregated.set(ancestorId, (aggregated.get(ancestorId) || 0) + count);
    }
  }
  return aggregated;
}

// =============================================================================
// Unit Types Hooks
// =============================================================================

export function useUnitTypes(params = {}) {
  return useQuery({
    queryKey: organizationKeys.unitTypesList(params),
    queryFn: ({ signal }) => unitTypesApi.list(params, { signal }),
    staleTime: 5 * 60 * 1000, // Config data is relatively stable
  });
}

export function useUnitType(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.unitType(id),
    queryFn: ({ signal }) => unitTypesApi.get(id, { signal }),
    enabled: !!id,
    ...options,
  });
}

// =============================================================================
// Leadership Roles Hooks
// =============================================================================

export function useLeadershipRoles(params = {}) {
  return useQuery({
    queryKey: organizationKeys.leadershipRolesList(params),
    queryFn: () => leadershipRolesApi.list(params),
    staleTime: 5 * 60 * 1000,
  });
}

export function useLeadershipRole(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.leadershipRole(id),
    queryFn: () => leadershipRolesApi.get(id),
    enabled: !!id,
    ...options,
  });
}

// =============================================================================
// Assignment Types Hooks
// =============================================================================

export function useAssignmentTypes(params = {}) {
  return useQuery({
    queryKey: organizationKeys.assignmentTypesList(params),
    queryFn: () => assignmentTypesApi.list(params),
    staleTime: 5 * 60 * 1000,
  });
}

// =============================================================================
// Clinical Units Hooks
// =============================================================================

export function useClinicalUnits(params = {}) {
  return useQuery({
    queryKey: organizationKeys.unitsList(params),
    queryFn: ({ signal }) => clinicalUnitsApi.list(params, { signal }),
    staleTime: 30 * 1000, // 30 seconds
  });
}

export function useClinicalUnitsTree(options = {}) {
  return useQuery({
    queryKey: organizationKeys.unitsTree(),
    queryFn: ({ signal }) => clinicalUnitsApi.tree({ signal }),
    staleTime: 60 * 1000, // 1 minute - tree changes infrequently
    ...options,
  });
}

export function useClinicalUnit(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.unit(id),
    queryFn: ({ signal }) => clinicalUnitsApi.get(id, { signal }),
    enabled: !!id,
    ...options,
  });
}

export function useUnitChildren(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.unitChildren(id),
    queryFn: ({ signal }) => clinicalUnitsApi.children(id, {}, { signal }),
    enabled: !!id,
    ...options,
  });
}

export function useUnitAncestors(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.unitAncestors(id),
    queryFn: ({ signal }) => clinicalUnitsApi.ancestors(id, {}, { signal }),
    enabled: !!id,
    ...options,
  });
}

export function useUnitLeaders(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.unitLeaders(id),
    queryFn: () => clinicalUnitsApi.leaders(id),
    enabled: !!id,
    ...options,
  });
}

function useUnitAssignmentList({
  unitId,
  params,
  options,
  baseKey,
  fetcher,
}) {
  const queryClient = useQueryClient();
  const treeQuery = useClinicalUnitsTree();
  const treeNodes = getTreeNodes(treeQuery.data);
  const treeIndex = useMemo(() => buildOrgTreeIndex(treeNodes), [treeNodes]);
  const includeDescendants = params?.include_descendants;
  const queryValue = params?.q || '';
  const pageSizeValue = params?.page_size || '';

  const querySuffix = useMemo(
    () => [
      includeDescendants ? 'desc' : 'direct',
      queryValue,
      pageSizeValue,
    ],
    [includeDescendants, pageSizeValue, queryValue]
  );

  const sourceUnitId = useMemo(() => {
    if (!unitId) {
      return unitId;
    }
    if (!includeDescendants || !treeIndex.ancestorsById.size) {
      return unitId;
    }
    const ancestors = treeIndex.ancestorsById.get(unitId);
    if (!ancestors || ancestors.length === 0) {
      return unitId;
    }
    return findClosestCachedAncestorId(queryClient, ancestors, baseKey, querySuffix);
  }, [
    unitId,
    includeDescendants,
    treeIndex,
    queryClient,
    baseKey,
    querySuffix,
  ]);

  const queryKey = useMemo(() => (
    sourceUnitId
      ? [...baseKey(sourceUnitId), ...querySuffix]
      : []
  ), [baseKey, querySuffix, sourceUnitId]);

  const queryResult = usePaginatedQuery(
    queryKey,
    (queryParams) => fetcher(sourceUnitId, queryParams),
    {
      enabled: !!sourceUnitId,
      params,
      staleTime: 3 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      ...options,
    }
  );

  const isDerived = Boolean(
    includeDescendants &&
    sourceUnitId &&
    sourceUnitId !== unitId &&
    treeIndex.ancestorsById.size
  );

  const derivedPages = useMemo(() => {
    if (!queryResult.data?.pages) {
      return [];
    }
    if (!isDerived) {
      return queryResult.data.pages;
    }
    return filterAssignmentPages(queryResult.data.pages, unitId, treeIndex.ancestorsById);
  }, [isDerived, queryResult.data, unitId, treeIndex]);

  const loadedCount = useMemo(
    () => countAssignmentResults(derivedPages),
    [derivedPages]
  );

  const data = useMemo(() => {
    if (!queryResult.data) {
      return queryResult.data;
    }
    if (!isDerived) {
      return queryResult.data;
    }
    return {
      ...queryResult.data,
      pages: derivedPages,
    };
  }, [derivedPages, isDerived, queryResult.data]);

  const isCountExact = Boolean(queryResult.data && !queryResult.hasNextPage);

  return {
    ...queryResult,
    data,
    loadedCount,
    isCountExact,
    sourceUnitId,
    isDerived,
  };
}

function useUnitAssignmentCounts({
  unitId,
  params,
  options,
  baseKey,
  fetcher,
}) {
  const queryClient = useQueryClient();
  const treeQuery = useClinicalUnitsTree();
  const treeNodes = getTreeNodes(treeQuery.data);
  const treeIndex = useMemo(() => buildOrgTreeIndex(treeNodes), [treeNodes]);
  const includeDescendants = params?.include_descendants;
  const queryValue = params?.q || '';

  const querySuffix = useMemo(
    () => [includeDescendants ? 'desc' : 'direct', queryValue],
    [includeDescendants, queryValue]
  );

  const sourceUnitId = useMemo(() => {
    if (!unitId) {
      return unitId;
    }
    if (!includeDescendants || !treeIndex.ancestorsById.size) {
      return unitId;
    }
    const ancestors = treeIndex.ancestorsById.get(unitId);
    if (!ancestors || ancestors.length === 0) {
      return unitId;
    }
    return findClosestCachedAncestorId(
      queryClient,
      ancestors,
      baseKey,
      querySuffix,
      (cached) => cached !== undefined
    );
  }, [
    unitId,
    includeDescendants,
    treeIndex,
    queryClient,
    baseKey,
    querySuffix,
  ]);

  const queryKey = useMemo(() => (
    sourceUnitId
      ? [...baseKey(sourceUnitId), ...querySuffix]
      : []
  ), [baseKey, querySuffix, sourceUnitId]);

  const queryResult = useQuery({
    queryKey,
    queryFn: () => fetcher(sourceUnitId, {
      include_descendants: includeDescendants,
      q: queryValue,
    }),
    enabled: !!sourceUnitId,
    staleTime: 3 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...options,
  });

  const countsPayload = useMemo(
    () => normalizeCountsPayload(queryResult.data),
    [queryResult.data]
  );
  const aggregatedCounts = useMemo(
    () => aggregateCountsByUnit(countsPayload, treeIndex.ancestorsById),
    [countsPayload, treeIndex]
  );
  const hasCounts = queryResult.data !== undefined;
  const hasTreeIndex = treeIndex.ancestorsById.size > 0;
  const totalCount = useMemo(() => {
    if (!unitId || !hasCounts) {
      return null;
    }
    if (includeDescendants && !hasTreeIndex) {
      return null;
    }
    if (!hasTreeIndex) {
      return Number(countsPayload?.[unitId]) || 0;
    }
    return aggregatedCounts.get(unitId) || 0;
  }, [aggregatedCounts, countsPayload, hasCounts, hasTreeIndex, includeDescendants, unitId]);

  const isDerived = Boolean(
    includeDescendants &&
    sourceUnitId &&
    sourceUnitId !== unitId &&
    treeIndex.ancestorsById.size
  );

  return {
    ...queryResult,
    totalCount,
    sourceUnitId,
    isDerived,
  };
}

export function useUnitStaff(id, params = {}, options = {}) {
  return useUnitAssignmentList({
    unitId: id,
    params,
    options,
    baseKey: organizationKeys.unitStaffBase,
    fetcher: clinicalUnitsApi.staffPaginated,
  });
}

export function useUnitStaffCounts(id, params = {}, options = {}) {
  return useUnitAssignmentCounts({
    unitId: id,
    params,
    options,
    baseKey: organizationKeys.unitStaffCountsBase,
    fetcher: clinicalUnitsApi.staffCounts,
  });
}

export function useUnitMembers(id, params = {}, options = {}) {
  return useUnitAssignmentList({
    unitId: id,
    params,
    options,
    baseKey: organizationKeys.unitMembersBase,
    fetcher: clinicalUnitsApi.membersPaginated,
  });
}

export function useUnitMembersCounts(id, params = {}, options = {}) {
  return useUnitAssignmentCounts({
    unitId: id,
    params,
    options,
    baseKey: organizationKeys.unitMembersCountsBase,
    fetcher: clinicalUnitsApi.membersCounts,
  });
}

export function useUnitWards(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.unitWards(id),
    queryFn: ({ signal }) => clinicalUnitsApi.wards(id, { signal }),
    enabled: !!id,
    ...options,
  });
}

// =============================================================================
// Clinical Unit Mutations
// =============================================================================

export function useCreateClinicalUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => clinicalUnitsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

export function useUpdateClinicalUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    // Unit edits submit only changed fields, so this must remain a PATCH.
    mutationFn: ({ id, data }) => clinicalUnitsApi.patch(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.unit(id) });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

export function useDeleteClinicalUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => clinicalUnitsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

// =============================================================================
// Leadership Assignment Hooks & Mutations
// =============================================================================

export function useLeadershipAssignments(params = {}) {
  return useQuery({
    queryKey: organizationKeys.leadershipList(params),
    queryFn: () => leadershipApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateLeadershipAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => leadershipApi.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.leadership() });
      if (variables.unit) {
        queryClient.invalidateQueries({ queryKey: organizationKeys.unitLeaders(variables.unit) });
      }
    },
  });
}

export function useUpdateLeadershipAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => leadershipApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.leadership() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

export function useDeleteLeadershipAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => leadershipApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.leadership() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

// =============================================================================
// Staff Assignment Hooks & Mutations
// =============================================================================

export function useStaffAssignments(params = {}) {
  return useQuery({
    queryKey: organizationKeys.staffAssignmentsList(params),
    queryFn: () => staffAssignmentsApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateStaffAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => staffAssignmentsApi.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.staffAssignments() });
      if (variables.unit) {
        queryClient.invalidateQueries({ queryKey: organizationKeys.unitStaffBase(variables.unit) });
      }
    },
  });
}

export function useUpdateStaffAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => staffAssignmentsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.staffAssignments() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

export function useDeleteStaffAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => staffAssignmentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.staffAssignments() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

// =============================================================================
// Ops Unit Member Hooks & Mutations
// =============================================================================

export function useUnitMembersList(params = {}) {
  return useQuery({
    queryKey: organizationKeys.unitMembersList(params),
    queryFn: () => unitMembersApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateUnitMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => unitMembersApi.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.unitMembersList({}) });
      if (variables.unit) {
        queryClient.invalidateQueries({ queryKey: organizationKeys.unitMembersBase(variables.unit) });
      }
    },
  });
}

export function useUpdateUnitMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => unitMembersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.unitMembersList({}) });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

export function useDeleteUnitMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => unitMembersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.unitMembersList({}) });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

// =============================================================================
// Cross Coverage Hooks & Mutations
// =============================================================================

export function useCrossCoverageSchedules(params = {}) {
  return useQuery({
    queryKey: organizationKeys.crossCoverageList(params),
    queryFn: () => crossCoverageApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateCrossCoverage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => crossCoverageApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.crossCoverage() });
    },
  });
}

export function useUpdateCrossCoverage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => crossCoverageApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.crossCoverage() });
    },
  });
}

export function useDeleteCrossCoverage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => crossCoverageApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.crossCoverage() });
    },
  });
}

// =============================================================================
// Ward Allocation Hooks & Mutations
// =============================================================================

export function useWardAllocations(params = {}) {
  return useQuery({
    queryKey: organizationKeys.wardAllocationsList(params),
    queryFn: () => wardAllocationsApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateWardAllocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => wardAllocationsApi.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.wardAllocations() });
      if (variables.unit) {
        queryClient.invalidateQueries({ queryKey: organizationKeys.unitWards(variables.unit) });
      }
    },
  });
}

export function useUpdateWardAllocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => wardAllocationsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.wardAllocations() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

export function useDeleteWardAllocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => wardAllocationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.wardAllocations() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.units() });
    },
  });
}

// =============================================================================
// Shift Definition Hooks & Mutations
// =============================================================================

export function useShiftDefinitions(params = {}) {
  return useQuery({
    queryKey: organizationKeys.shiftDefinitionsList(params),
    queryFn: () => shiftDefinitionsApi.list(params),
    staleTime: 5 * 60 * 1000, // 5 minutes - shifts don't change often
  });
}

export function useShiftDefinition(id) {
  return useQuery({
    queryKey: organizationKeys.shiftDefinition(id),
    queryFn: () => shiftDefinitionsApi.get(id),
    enabled: !!id,
  });
}

export function useCreateShiftDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => shiftDefinitionsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.shiftDefinitions() });
    },
  });
}

export function useUpdateShiftDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => shiftDefinitionsApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.shiftDefinition(id) });
      queryClient.invalidateQueries({ queryKey: organizationKeys.shiftDefinitions() });
    },
  });
}

export function useDeleteShiftDefinition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => shiftDefinitionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.shiftDefinitions() });
    },
  });
}

// =============================================================================
// Duty Roster Template Hooks & Mutations
// =============================================================================

export function useDutyRosterTemplates(params = {}) {
  return useQuery({
    queryKey: organizationKeys.dutyRosterTemplatesList(params),
    queryFn: () => dutyRosterTemplatesApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useDutyRosterTemplate(id) {
  return useQuery({
    queryKey: organizationKeys.dutyRosterTemplate(id),
    queryFn: () => dutyRosterTemplatesApi.get(id),
    enabled: !!id,
  });
}

export function useCreateDutyRosterTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => dutyRosterTemplatesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRosterTemplates() });
    },
  });
}

export function useUpdateDutyRosterTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => dutyRosterTemplatesApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRosterTemplate(id) });
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRosterTemplates() });
    },
  });
}

export function useDeleteDutyRosterTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => dutyRosterTemplatesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRosterTemplates() });
    },
  });
}

// =============================================================================
// Duty Roster Hooks & Mutations
// =============================================================================

export function useDepartmentDutyTypes(params = {}) {
  return useQuery({
    queryKey: organizationKeys.departmentDutyTypesList(params),
    queryFn: () => departmentDutyTypesApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateDepartmentDutyType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => departmentDutyTypesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentDutyTypes() });
    },
  });
}

export function useUpdateDepartmentDutyType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => departmentDutyTypesApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentDutyTypes() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentDutyType(id) });
    },
  });
}

export function useDeleteDepartmentDutyType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => departmentDutyTypesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentDutyTypes() });
    },
  });
}

export function useDepartmentStations(params = {}) {
  return useQuery({
    queryKey: organizationKeys.departmentStationsList(params),
    queryFn: () => departmentStationsApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateDepartmentStation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => departmentStationsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentStations() });
    },
  });
}

export function useUpdateDepartmentStation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => departmentStationsApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentStations() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentStation(id) });
    },
  });
}

export function useDeleteDepartmentStation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => departmentStationsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentStations() });
    },
  });
}

export function useDepartmentRosterPlans(params = {}) {
  return useQuery({
    queryKey: organizationKeys.departmentRosterPlansList(params),
    queryFn: () => departmentRosterPlansApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateDepartmentRosterPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => departmentRosterPlansApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPlans() });
    },
  });
}

export function useUpdateDepartmentRosterPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => departmentRosterPlansApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPlans() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPlan(id) });
    },
  });
}

export function useDeleteDepartmentRosterPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => departmentRosterPlansApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPlans() });
    },
  });
}

export function useDepartmentRosterPatterns(params = {}) {
  return useQuery({
    queryKey: organizationKeys.departmentRosterPatternsList(params),
    queryFn: () => departmentRosterPatternsApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateDepartmentRosterPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => departmentRosterPatternsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPatterns() });
    },
  });
}

export function useUpdateDepartmentRosterPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => departmentRosterPatternsApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPatterns() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPattern(id) });
    },
  });
}

export function useDeleteDepartmentRosterPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => departmentRosterPatternsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPatterns() });
    },
  });
}

export function useRosterPatternSlots(params = {}) {
  return useQuery({
    queryKey: organizationKeys.rosterPatternSlotsList(params),
    queryFn: () => rosterPatternSlotsApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateRosterPatternSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => rosterPatternSlotsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterPatternSlots() });
    },
  });
}

export function useUpdateRosterPatternSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => rosterPatternSlotsApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterPatternSlots() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterPatternSlot(id) });
    },
  });
}

export function useDeleteRosterPatternSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => rosterPatternSlotsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterPatternSlots() });
    },
  });
}

export function useRosterOverrides(params = {}) {
  return useQuery({
    queryKey: organizationKeys.rosterOverridesList(params),
    queryFn: () => rosterOverridesApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateRosterOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => rosterOverridesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterOverrides() });
    },
  });
}

export function useUpdateRosterOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => rosterOverridesApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterOverrides() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterOverride(id) });
    },
  });
}

export function useDeleteRosterOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => rosterOverridesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterOverrides() });
    },
  });
}

export function useTeamRosterPlans(params = {}) {
  return useQuery({
    queryKey: organizationKeys.teamRosterPlansList(params),
    queryFn: () => teamRosterPlansApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateTeamRosterPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => teamRosterPlansApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterPlans() });
    },
  });
}

export function useUpdateTeamRosterPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => teamRosterPlansApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterPlans() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterPlan(id) });
    },
  });
}

export function useDeleteTeamRosterPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => teamRosterPlansApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterPlans() });
    },
  });
}

export function useTeamRosterEntries(params = {}) {
  return useQuery({
    queryKey: organizationKeys.teamRosterEntriesList(params),
    queryFn: () => teamRosterEntriesApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useCreateTeamRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => teamRosterEntriesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterEntries() });
    },
  });
}

export function useUpdateTeamRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => teamRosterEntriesApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterEntries() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterEntry(id) });
    },
  });
}

export function useDeleteTeamRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => teamRosterEntriesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterEntries() });
    },
  });
}

export function useDepartmentRosterImportPreview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => departmentRosterPlansApi.importPreview(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPlans() });
    },
  });
}

export function useDepartmentRosterImportApply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => departmentRosterPlansApi.importApply(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.departmentRosterPlans() });
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterPatternSlots() });
    },
  });
}

export function useTeamRosterImportPreview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => teamRosterEntriesApi.importPreview(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterEntries() });
    },
  });
}

export function useTeamRosterImportApply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => teamRosterEntriesApi.importApply(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.teamRosterEntries() });
    },
  });
}

export function useDutyRoster(params = {}) {
  return useQuery({
    queryKey: organizationKeys.dutyRosterList(params),
    queryFn: () => dutyRosterApi.list(params),
    staleTime: 30 * 1000,
  });
}

export function useDutyRosterEntry(id) {
  return useQuery({
    queryKey: organizationKeys.dutyRosterEntry(id),
    queryFn: () => dutyRosterApi.get(id),
    enabled: !!id,
  });
}

export function useOnDuty(params) {
  const unitId = params?.unit_id;
  return useQuery({
    queryKey: organizationKeys.onDuty(params || {}),
    queryFn: () => dutyRosterApi.onDuty(params),
    enabled: !!unitId,
    staleTime: 60 * 1000, // 1 minute
  });
}

export function useCreateDutyRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => dutyRosterApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRoster() });
    },
  });
}

export function useGenerateRoster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => dutyRosterApi.generate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRoster() });
    },
  });
}

export function useSwapDuty() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => dutyRosterApi.swap(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRoster() });
    },
  });
}

export function useUpdateDutyRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => dutyRosterApi.update(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRosterEntry(id) });
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRoster() });
    },
  });
}

export function useDeleteDutyRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => dutyRosterApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.dutyRoster() });
    },
  });
}

// =============================================================================
// Clinics Hooks
// =============================================================================

export function useClinics(params = {}, options = {}) {
  return useQuery({
    queryKey: organizationKeys.clinicsList(params),
    queryFn: ({ signal }) => clinicsApi.list(params, { signal }),
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useClinic(id, options = {}) {
  return useQuery({
    queryKey: [...organizationKeys.clinics(), id],
    queryFn: ({ signal }) => clinicsApi.get(id, { signal }),
    enabled: !!id,
    ...options,
  });
}

export function useCreateClinic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => clinicsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.clinics() });
    },
  });
}

export function useUpdateClinic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => clinicsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.clinics() });
    },
  });
}

export function useDeleteClinic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => clinicsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.clinics() });
    },
  });
}

export function useClinicSchedules(params = {}, options = {}) {
  return useQuery({
    queryKey: organizationKeys.clinicSchedulesList(params),
    queryFn: () => clinicSchedulesApi.list(params),
    staleTime: 30 * 1000,
    ...options,
  });
}

// =============================================================================
// Rotation Rules Hooks (Simplified Roster System)
// =============================================================================

export function useRotationRules(departmentId, params = {}, options = {}) {
  return useQuery({
    queryKey: organizationKeys.rotationRulesList(departmentId, params),
    queryFn: () => rotationRulesApi.list(departmentId, params),
    enabled: !!departmentId,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export function useRotationRule(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.rotationRule(id),
    queryFn: () => rotationRulesApi.get(id),
    enabled: !!id,
    ...options,
  });
}

export function useCreateRotationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ departmentId, data }) => rotationRulesApi.create(departmentId, data),
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rotationRulesList(departmentId, {}) });
    },
  });
}

export function useUpdateRotationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => rotationRulesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rotationRules() });
    },
  });
}

export function useDeleteRotationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => rotationRulesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rotationRules() });
    },
  });
}

// =============================================================================
// Roster Entries Hooks (Simplified Roster System)
// =============================================================================

export function useRosterEntries(departmentId, params = {}, options = {}) {
  return useQuery({
    queryKey: organizationKeys.rosterEntriesList(departmentId, params),
    queryFn: () => rosterEntriesApi.list(departmentId, params),
    enabled: !!departmentId,
    staleTime: 30 * 1000,
    ...options,
  });
}

export function useRosterEntry(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.rosterEntry(id),
    queryFn: () => rosterEntriesApi.get(id),
    enabled: !!id,
    ...options,
  });
}

export function useCreateRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ departmentId, data }) => rosterEntriesApi.create(departmentId, data),
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntriesList(departmentId, {}) });
    },
  });
}

export function useUpdateRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => rosterEntriesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntries() });
    },
  });
}

export function useDeleteRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => rosterEntriesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntries() });
    },
  });
}

export function useGenerateRosterEntries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ departmentId, data }) => rosterEntriesApi.generate(departmentId, data),
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntriesList(departmentId, {}) });
    },
  });
}

export function useBulkRosterEntries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ departmentId, data }) => rosterEntriesApi.bulk(departmentId, data),
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntriesList(departmentId, {}) });
    },
  });
}

export function useImportRosterCsv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ departmentId, data }) => rosterEntriesApi.importCsv(departmentId, data),
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntriesList(departmentId, {}) });
    },
  });
}

export function usePublishRoster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ departmentId, data }) => rosterEntriesApi.publish(departmentId, data),
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntriesList(departmentId, {}) });
    },
  });
}

export function useClearRoster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ departmentId, data }) => rosterEntriesApi.clear(departmentId, data),
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntriesList(departmentId, {}) });
    },
  });
}

export function useOverrideRosterEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => rosterEntriesApi.override(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.rosterEntries() });
    },
  });
}

export function useRosterOnDutyDepartment(departmentId, params = {}, options = {}) {
  return useQuery({
    queryKey: organizationKeys.rosterOnDutyDepartment(departmentId, params),
    queryFn: () => rosterEntriesApi.onDutyDepartment(departmentId, params),
    enabled: !!departmentId,
    staleTime: 60 * 1000,
    ...options,
  });
}

export function useRosterOnDutyAll(params = {}, options = {}) {
  return useQuery({
    queryKey: organizationKeys.rosterOnDutyAll(params),
    queryFn: () => rosterEntriesApi.onDutyAll(params),
    staleTime: 60 * 1000,
    ...options,
  });
}

/**
 * Convenience hook to fetch departments (units with unit_type code 'department')
 */
export function useDepartments(options = {}) {
  return useClinicalUnits({ is_active: true }, options);
}

// =============================================================================
// Validation Rules Hooks
// =============================================================================

export function useValidationRules(departmentId, params = {}, options = {}) {
  return useQuery({
    queryKey: organizationKeys.validationRulesList(departmentId, params),
    queryFn: () => validationRulesApi.list(departmentId, params),
    enabled: !!departmentId,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}

export function useValidationRule(id, options = {}) {
  return useQuery({
    queryKey: organizationKeys.validationRule(id),
    queryFn: () => validationRulesApi.get(id),
    enabled: !!id,
    ...options,
  });
}

export function useValidationRuleTemplates(options = {}) {
  return useQuery({
    queryKey: organizationKeys.validationRuleTemplates(),
    queryFn: () => validationRulesApi.templates(),
    staleTime: 60 * 60 * 1000, // Templates rarely change
    ...options,
  });
}

export function useCreateValidationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ departmentId, data }) => validationRulesApi.create(departmentId, data),
    onSuccess: (_, { departmentId }) => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.validationRulesList(departmentId, {}) });
    },
  });
}

export function useUpdateValidationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => validationRulesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.validationRules() });
    },
  });
}

export function useDeleteValidationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => validationRulesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.validationRules() });
    },
  });
}

export function useValidateRoster() {
  return useMutation({
    mutationFn: (data) => validationRulesApi.validate(data),
  });
}
