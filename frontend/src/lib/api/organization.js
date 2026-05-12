/**
 * Organization API client for managing clinical units and organizational hierarchy.
 */
import { apiClient } from '../api-client';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

function normalizeV2OrgLimit(params = {}, fallback = 100) {
  const parsed = Number.parseInt(String(params.limit || params.page_size || fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function titleCase(value) {
  return String(value || '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function adaptV2OrgUnit(unit) {
  const unitType = unit.unit_type || unit.unit_type_code || 'department';
  return {
    ...unit,
    unit_type_code: unitType,
    unit_type_name: unit.unit_type_name || titleCase(unitType),
    unit_category: unit.unit_category || (unitType === 'department' ? 'clinical' : 'administrative'),
    parentId: unit.parentId || unit.parent_unit_id || null,
  };
}

function filterV2OrgUnits(units, params = {}) {
  return units.filter((unit) => {
    if (params.unit_type_code && unit.unit_type_code !== params.unit_type_code) {
      return false;
    }
    if (params.unit_category && unit.unit_category !== params.unit_category) {
      return false;
    }
    if (params.is_active !== undefined && params.is_active !== null && params.is_active !== '') {
      const expected = params.is_active === true || params.is_active === 'true';
      if (Boolean(unit.is_active) !== expected) {
        return false;
      }
    }
    return true;
  });
}

function adaptV2Clinic(clinic) {
  return {
    ...clinic,
    booking_mode: clinic.booking_mode || 'clinic_pool',
    waitlist_enabled: Boolean(clinic.waitlist_enabled),
  };
}

function filterV2Clinics(clinics, params = {}) {
  return clinics.filter((clinic) => {
    if (params.is_active !== undefined && params.is_active !== null && params.is_active !== '') {
      const expected = params.is_active === true || params.is_active === 'true';
      if (Boolean(clinic.is_active) !== expected) {
        return false;
      }
    }
    return true;
  });
}

const DEFAULT_V2_UNIT_TYPES = [
  {
    id: 'facility',
    code: 'facility',
    name: 'Facility',
    can_be_root: true,
  },
  {
    id: 'department',
    code: 'department',
    name: 'Department',
    can_be_root: true,
  },
  {
    id: 'ward',
    code: 'ward',
    name: 'Ward',
    can_be_root: false,
  },
  {
    id: 'clinic',
    code: 'clinic',
    name: 'Clinic',
    can_be_root: false,
  },
  {
    id: 'administrative',
    code: 'administrative',
    name: 'Administrative',
    can_be_root: true,
  },
];

function unitTypeFromCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  return DEFAULT_V2_UNIT_TYPES.find((unitType) => unitType.code === normalized) || {
    id: normalized,
    code: normalized,
    name: titleCase(normalized),
    can_be_root: false,
  };
}

async function listV2OrgUnits(params = {}) {
  const response = await v2Api.getAdminOrgUnits({
    query: {
      cursor: params.cursor,
      limit: normalizeV2OrgLimit(params),
    },
    signal: params.signal,
  });
  const units = Array.isArray(response?.data)
    ? response.data.map(adaptV2OrgUnit)
    : [];
  return filterV2OrgUnits(units, params);
}

async function listV2Clinics(params = {}) {
  const response = await v2Api.getClinics({
    query: {
      cursor: params.cursor,
      limit: normalizeV2OrgLimit(params, 50),
    },
    signal: params.signal,
  });
  const clinics = Array.isArray(response?.data)
    ? response.data.map(adaptV2Clinic)
    : [];
  return filterV2Clinics(clinics, params);
}

async function listV2UnitTypes(params = {}) {
  const units = await listV2OrgUnits(params);
  const seen = new Set();
  const unitTypes = [];
  for (const unit of units) {
    const code = unit.unit_type_code || unit.unit_type;
    if (!code || seen.has(code)) {
      continue;
    }
    seen.add(code);
    unitTypes.push(unitTypeFromCode(code));
  }
  return unitTypes;
}

function unsupportedInRustV2(message) {
  return Promise.reject(new Error(message));
}

// =============================================================================
// Configuration Endpoints
// =============================================================================

/**
 * Unit Types API
 */
export const unitTypesApi = {
  list: (params = {}) => {
    if (isRustV2ApiMode()) {
      return listV2UnitTypes(params);
    }
    return apiClient.get('/organization/unit-types/', { params });
  },
  get: (id) => apiClient.get(`/organization/unit-types/${id}/`),
  create: (data) => apiClient.post('/organization/unit-types/', data),
  update: (id, data) => apiClient.patch(`/organization/unit-types/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/unit-types/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/unit-types/${id}/`),
};

/**
 * Leadership Roles API
 */
export const leadershipRolesApi = {
  list: (params = {}) => apiClient.get('/organization/leadership-roles/', { params }),
  get: (id) => apiClient.get(`/organization/leadership-roles/${id}/`),
  create: (data) => apiClient.post('/organization/leadership-roles/', data),
  update: (id, data) => apiClient.patch(`/organization/leadership-roles/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/leadership-roles/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/leadership-roles/${id}/`),
};

/**
 * Assignment Types API
 */
export const assignmentTypesApi = {
  list: (params = {}) => apiClient.get('/organization/assignment-types/', { params }),
  get: (id) => apiClient.get(`/organization/assignment-types/${id}/`),
  create: (data) => apiClient.post('/organization/assignment-types/', data),
  update: (id, data) => apiClient.patch(`/organization/assignment-types/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/assignment-types/${id}/`),
};

// =============================================================================
// Clinical Units Endpoints
// =============================================================================

/**
 * Clinical Units API
 */
export const clinicalUnitsApi = {
  list: (params = {}) => {
    if (isRustV2ApiMode()) {
      return listV2OrgUnits(params);
    }
    return apiClient.get('/organization/units/', { params });
  },
  get: (id) => apiClient.get(`/organization/units/${id}/`),
  create: (data) => apiClient.post('/organization/units/', data),
  update: (id, data) => apiClient.patch(`/organization/units/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/units/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/units/${id}/`),

  // Tree and hierarchy
  tree: () => {
    if (isRustV2ApiMode()) {
      return listV2OrgUnits();
    }
    return apiClient.get('/organization/units/tree/');
  },
  children: (id) => apiClient.get(`/organization/units/${id}/children/`),
  ancestors: (id) => apiClient.get(`/organization/units/${id}/ancestors/`),
  descendants: (id, params = {}) => apiClient.get(`/organization/units/${id}/descendants/`, { params }),

  // Related data
  leaders: (id) => apiClient.get(`/organization/units/${id}/leaders/`),
  staff: (id, params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return apiClient.get(`/organization/units/${id}/staff/${queryString ? `?${queryString}` : ''}`);
  },
  staffCounts: (id, params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return apiClient.get(`/organization/units/${id}/staff/counts/${queryString ? `?${queryString}` : ''}`);
  },
  staffPaginated: (id, params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return apiClient.getWithPagination(`/organization/units/${id}/staff/${queryString ? `?${queryString}` : ''}`);
  },
  members: (id, params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return apiClient.get(`/organization/units/${id}/members/${queryString ? `?${queryString}` : ''}`);
  },
  membersCounts: (id, params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return apiClient.get(`/organization/units/${id}/members/counts/${queryString ? `?${queryString}` : ''}`);
  },
  membersPaginated: (id, params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return apiClient.getWithPagination(`/organization/units/${id}/members/${queryString ? `?${queryString}` : ''}`);
  },
  wards: (id) => apiClient.get(`/organization/units/${id}/wards/`),
  coverage: (id) => apiClient.get(`/organization/units/${id}/coverage/`),
};

// =============================================================================
// Leadership Assignments Endpoints
// =============================================================================

/**
 * Unit Leadership API
 */
export const leadershipApi = {
  list: (params = {}) => apiClient.get('/organization/leadership/', { params }),
  get: (id) => apiClient.get(`/organization/leadership/${id}/`),
  create: (data) => apiClient.post('/organization/leadership/', data),
  update: (id, data) => apiClient.patch(`/organization/leadership/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/leadership/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/leadership/${id}/`),
};

// =============================================================================
// Staff Assignments Endpoints
// =============================================================================

/**
 * Staff Unit Assignments API
 */
export const staffAssignmentsApi = {
  list: (params = {}) => apiClient.get('/organization/staff-assignments/', { params }),
  get: (id) => apiClient.get(`/organization/staff-assignments/${id}/`),
  create: (data) => apiClient.post('/organization/staff-assignments/', data),
  update: (id, data) => apiClient.patch(`/organization/staff-assignments/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/staff-assignments/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/staff-assignments/${id}/`),
};

/**
 * Ops Unit Member Assignments API
 */
export const unitMembersApi = {
  list: (params = {}) => apiClient.get('/organization/unit-members/', { params }),
  get: (id) => apiClient.get(`/organization/unit-members/${id}/`),
  create: (data) => apiClient.post('/organization/unit-members/', data),
  update: (id, data) => apiClient.patch(`/organization/unit-members/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/unit-members/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/unit-members/${id}/`),
};

// =============================================================================
// Cross Coverage Endpoints
// =============================================================================

/**
 * Cross Coverage Schedules API
 */
export const crossCoverageApi = {
  list: (params = {}) => apiClient.get('/organization/cross-coverage/', { params }),
  get: (id) => apiClient.get(`/organization/cross-coverage/${id}/`),
  create: (data) => apiClient.post('/organization/cross-coverage/', data),
  update: (id, data) => apiClient.patch(`/organization/cross-coverage/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/cross-coverage/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/cross-coverage/${id}/`),
};

// =============================================================================
// Ward Allocations Endpoints
// =============================================================================

/**
 * Unit Ward Allocations API
 */
export const wardAllocationsApi = {
  list: (params = {}) => apiClient.get('/organization/ward-allocations/', { params }),
  get: (id) => apiClient.get(`/organization/ward-allocations/${id}/`),
  create: (data) => apiClient.post('/organization/ward-allocations/', data),
  update: (id, data) => apiClient.patch(`/organization/ward-allocations/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/ward-allocations/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/ward-allocations/${id}/`),
};

// =============================================================================
// Department Roster Endpoints
// =============================================================================

export const departmentDutyTypesApi = {
  list: (params = {}) => apiClient.get('/organization/department-duty-types/', { params }),
  get: (id) => apiClient.get(`/organization/department-duty-types/${id}/`),
  create: (data) => apiClient.post('/organization/department-duty-types/', data),
  update: (id, data) => apiClient.patch(`/organization/department-duty-types/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/department-duty-types/${id}/`),
};

export const departmentStationsApi = {
  list: (params = {}) => apiClient.get('/organization/department-stations/', { params }),
  get: (id) => apiClient.get(`/organization/department-stations/${id}/`),
  create: (data) => apiClient.post('/organization/department-stations/', data),
  update: (id, data) => apiClient.patch(`/organization/department-stations/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/department-stations/${id}/`),
};

export const departmentRosterPlansApi = {
  list: (params = {}) => apiClient.get('/organization/department-roster-plans/', { params }),
  get: (id) => apiClient.get(`/organization/department-roster-plans/${id}/`),
  create: (data) => apiClient.post('/organization/department-roster-plans/', data),
  update: (id, data) => apiClient.patch(`/organization/department-roster-plans/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/department-roster-plans/${id}/`),
  importPreview: (data) => apiClient.post('/organization/department-roster-plans/import/preview/', data),
  importApply: (data) => apiClient.post('/organization/department-roster-plans/import/apply/', data),
};

export const departmentRosterPatternsApi = {
  list: (params = {}) => apiClient.get('/organization/department-roster-patterns/', { params }),
  get: (id) => apiClient.get(`/organization/department-roster-patterns/${id}/`),
  create: (data) => apiClient.post('/organization/department-roster-patterns/', data),
  update: (id, data) => apiClient.patch(`/organization/department-roster-patterns/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/department-roster-patterns/${id}/`),
};

export const rosterPatternSlotsApi = {
  list: (params = {}) => apiClient.get('/organization/department-roster-slots/', { params }),
  get: (id) => apiClient.get(`/organization/department-roster-slots/${id}/`),
  create: (data) => apiClient.post('/organization/department-roster-slots/', data),
  update: (id, data) => apiClient.patch(`/organization/department-roster-slots/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/department-roster-slots/${id}/`),
};

export const rosterOverridesApi = {
  list: (params = {}) => apiClient.get('/organization/department-roster-overrides/', { params }),
  get: (id) => apiClient.get(`/organization/department-roster-overrides/${id}/`),
  create: (data) => apiClient.post('/organization/department-roster-overrides/', data),
  update: (id, data) => apiClient.patch(`/organization/department-roster-overrides/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/department-roster-overrides/${id}/`),
};

export const teamRosterPlansApi = {
  list: (params = {}) => apiClient.get('/organization/team-roster-plans/', { params }),
  get: (id) => apiClient.get(`/organization/team-roster-plans/${id}/`),
  create: (data) => apiClient.post('/organization/team-roster-plans/', data),
  update: (id, data) => apiClient.patch(`/organization/team-roster-plans/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/team-roster-plans/${id}/`),
};

export const teamRosterEntriesApi = {
  list: (params = {}) => apiClient.get('/organization/team-roster-entries/', { params }),
  get: (id) => apiClient.get(`/organization/team-roster-entries/${id}/`),
  create: (data) => apiClient.post('/organization/team-roster-entries/', data),
  update: (id, data) => apiClient.patch(`/organization/team-roster-entries/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/team-roster-entries/${id}/`),
  importPreview: (data) => apiClient.post('/organization/team-roster-entries/import/preview/', data),
  importApply: (data) => apiClient.post('/organization/team-roster-entries/import/apply/', data),
};

// =============================================================================
// Duty Roster Endpoints
// =============================================================================

/**
 * Shift Definitions API
 */
export const shiftDefinitionsApi = {
  list: (params = {}) => apiClient.get('/organization/shift-definitions/', { params }),
  get: (id) => apiClient.get(`/organization/shift-definitions/${id}/`),
  create: (data) => apiClient.post('/organization/shift-definitions/', data),
  update: (id, data) => apiClient.patch(`/organization/shift-definitions/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/shift-definitions/${id}/`),
};

/**
 * Duty Roster Templates API
 */
export const dutyRosterTemplatesApi = {
  list: (params = {}) => apiClient.get('/organization/duty-roster-templates/', { params }),
  get: (id) => apiClient.get(`/organization/duty-roster-templates/${id}/`),
  create: (data) => apiClient.post('/organization/duty-roster-templates/', data),
  update: (id, data) => apiClient.patch(`/organization/duty-roster-templates/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/duty-roster-templates/${id}/`),
};

/**
 * Duty Roster API
 */
export const dutyRosterApi = {
  list: (params = {}) => apiClient.get('/organization/duty-roster/', { params }),
  get: (id) => apiClient.get(`/organization/duty-roster/${id}/`),
  create: (data) => apiClient.post('/organization/duty-roster/', data),
  update: (id, data) => apiClient.patch(`/organization/duty-roster/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/duty-roster/${id}/`),
  generate: (data) => apiClient.post('/organization/duty-roster/generate/', data),
  swap: (id, data) => apiClient.post(`/organization/duty-roster/${id}/swap/`, data),
  onDuty: (params) => apiClient.get('/organization/duty-roster/on-duty/', { params }),
};

// =============================================================================
// Simplified Roster Endpoints (per ROSTER_MANAGEMENT_SPEC.md)
// =============================================================================

/**
 * Rotation Rules API - Department-scoped
 */
export const rotationRulesApi = {
  list: (departmentId, params = {}) =>
    apiClient.get(`/organization/departments/${departmentId}/rotation-rules/`, { params }),
  get: (id) => apiClient.get(`/organization/rotation-rules/${id}/`),
  create: (departmentId, data) =>
    apiClient.post(`/organization/departments/${departmentId}/rotation-rules/`, { ...data, department: departmentId }),
  update: (id, data) => apiClient.patch(`/organization/rotation-rules/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/rotation-rules/${id}/`),
};

/**
 * Roster Entries API - Department-scoped simplified roster
 */
export const rosterEntriesApi = {
  list: (departmentId, params = {}) =>
    apiClient.get(`/organization/departments/${departmentId}/roster/`, { params }),
  get: (id) => apiClient.get(`/organization/roster/${id}/`),
  create: (departmentId, data) =>
    apiClient.post(`/organization/departments/${departmentId}/roster/`, data),
  update: (id, data) => apiClient.patch(`/organization/roster/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/roster/${id}/`),
  generate: (departmentId, data) =>
    apiClient.post(`/organization/departments/${departmentId}/roster/generate/`, data),
  bulk: (departmentId, data) =>
    apiClient.post(`/organization/departments/${departmentId}/roster/bulk/`, data),
  importCsv: (departmentId, data) =>
    apiClient.post(`/organization/departments/${departmentId}/roster/import/`, data),
  publish: (departmentId, data) =>
    apiClient.post(`/organization/departments/${departmentId}/roster/publish/`, data),
  clear: (departmentId, data) =>
    apiClient.post(`/organization/departments/${departmentId}/roster/clear/`, data),
  override: (id, data) =>
    apiClient.post(`/organization/roster/${id}/override/`, data),
  print: (departmentId, params = {}) =>
    apiClient.get(`/organization/departments/${departmentId}/roster/print/`, {
      params,
      responseType: 'blob',
    }),
  onDutyDepartment: (departmentId, params = {}) =>
    apiClient.get(`/organization/departments/${departmentId}/on-duty/`, { params }),
  onDutyAll: (params = {}) =>
    apiClient.get(`/organization/on-duty/`, { params }),
};

/**
 * Roster Validation Rules API
 */
export const validationRulesApi = {
  list: (departmentId, params = {}) =>
    apiClient.get(`/organization/departments/${departmentId}/validation-rules/`, { params }),
  get: (id) => apiClient.get(`/organization/validation-rules/${id}/`),
  create: (departmentId, data) =>
    apiClient.post(`/organization/departments/${departmentId}/validation-rules/`, { ...data, department: departmentId }),
  update: (id, data) => apiClient.patch(`/organization/validation-rules/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/validation-rules/${id}/`),
  templates: () => apiClient.get(`/organization/validation-rules/templates/`),
  validate: (data) => apiClient.post(`/organization/validation-rules/validate/`, data),
};

// =============================================================================
// Clinics Endpoints
// =============================================================================

/**
 * Clinics API
 */
export const clinicsApi = {
  list: (params = {}) => {
    if (isRustV2ApiMode()) {
      return listV2Clinics(params);
    }
    return apiClient.get('/organization/clinics/', { params });
  },
  get: async (id) => {
    if (isRustV2ApiMode()) {
      const clinics = await listV2Clinics({ limit: 100 });
      return clinics.find((clinic) => clinic.id === id) || null;
    }
    return apiClient.get(`/organization/clinics/${id}/`);
  },
  create: (data) => {
    if (isRustV2ApiMode()) {
      return unsupportedInRustV2('Rust V2 does not expose clinic management yet.');
    }
    return apiClient.post('/organization/clinics/', data);
  },
  update: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedInRustV2('Rust V2 does not expose clinic management yet.');
    }
    return apiClient.patch(`/organization/clinics/${id}/`, data);
  },
  delete: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedInRustV2('Rust V2 does not expose clinic management yet.');
    }
    return apiClient.delete(`/organization/clinics/${id}/`);
  },
};

/**
 * Clinic Schedules API
 */
export const clinicSchedulesApi = {
  list: (params = {}) => apiClient.get('/organization/clinic-schedules/', { params }),
  get: (id) => apiClient.get(`/organization/clinic-schedules/${id}/`),
};

export default {
  unitTypes: unitTypesApi,
  leadershipRoles: leadershipRolesApi,
  assignmentTypes: assignmentTypesApi,
  clinicalUnits: clinicalUnitsApi,
  leadership: leadershipApi,
  staffAssignments: staffAssignmentsApi,
  unitMembers: unitMembersApi,
  crossCoverage: crossCoverageApi,
  wardAllocations: wardAllocationsApi,
  shiftDefinitions: shiftDefinitionsApi,
  dutyRosterTemplates: dutyRosterTemplatesApi,
  dutyRoster: dutyRosterApi,
  departmentDutyTypes: departmentDutyTypesApi,
  departmentStations: departmentStationsApi,
  departmentRosterPlans: departmentRosterPlansApi,
  rosterPatternSlots: rosterPatternSlotsApi,
  rosterOverrides: rosterOverridesApi,
  teamRosterPlans: teamRosterPlansApi,
  teamRosterEntries: teamRosterEntriesApi,
  clinics: clinicsApi,
  clinicSchedules: clinicSchedulesApi,
  rotationRules: rotationRulesApi,
  rosterEntries: rosterEntriesApi,
  validationRules: validationRulesApi,
};
