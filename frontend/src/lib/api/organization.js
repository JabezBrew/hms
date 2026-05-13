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

const CLINICAL_V2_UNIT_TYPES = new Set(['department', 'clinic', 'ward', 'service']);

function splitRequestParams(params = {}, options = {}) {
  const { signal: paramSignal, ...queryParams } = params || {};
  const requestOptions = { ...options };
  if (requestOptions.signal === undefined && paramSignal !== undefined) {
    requestOptions.signal = paramSignal;
  }
  return { queryParams, requestOptions };
}

function adaptV2OrgUnit(unit) {
  const unitType = unit.unit_type || unit.unit_type_code || 'department';
  return {
    ...unit,
    unit_type_code: unitType,
    unit_type_name: unit.unit_type_name || titleCase(unitType),
    unit_category: unit.unit_category || (CLINICAL_V2_UNIT_TYPES.has(unitType) ? 'clinical' : 'administrative'),
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
    id: 'service',
    code: 'service',
    name: 'Service',
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

async function listV2OrgUnits(params = {}, options = {}) {
  const { queryParams, requestOptions } = splitRequestParams(params, options);
  const query = {};
  const unitType = queryParams.unit_type || queryParams.unit_type_code;
  if (unitType) {
    query.unit_type = unitType;
  }
  if (queryParams.is_active !== undefined && queryParams.is_active !== null && queryParams.is_active !== '') {
    query.is_active = queryParams.is_active === true || queryParams.is_active === 'true';
  }
  if (queryParams.cursor) {
    query.cursor = queryParams.cursor;
  }
  query.limit = normalizeV2OrgLimit(queryParams);

  const response = await v2Api.getAdminOrgUnits({
    query,
    signal: requestOptions.signal,
  });
  const units = Array.isArray(response?.data)
    ? response.data.map(adaptV2OrgUnit)
    : [];
  return filterV2OrgUnits(units, queryParams);
}

async function listV2Clinics(params = {}, options = {}) {
  const { queryParams, requestOptions } = splitRequestParams(params, options);
  const response = await v2Api.getClinics({
    query: {
      cursor: queryParams.cursor,
      limit: normalizeV2OrgLimit(queryParams, 50),
    },
    signal: requestOptions.signal,
  });
  const clinics = Array.isArray(response?.data)
    ? response.data.map(adaptV2Clinic)
    : [];
  return filterV2Clinics(clinics, queryParams);
}

async function getV2Clinic(id, options = {}) {
  const response = await v2Api.getClinicById(
    { id },
    { signal: options.signal },
  );
  return adaptV2Clinic(response?.data || response || {});
}

async function listV2UnitTypes(params = {}, options = {}) {
  const units = await listV2OrgUnits(params, options);
  const seen = new Set(DEFAULT_V2_UNIT_TYPES.map((unitType) => unitType.code));
  const unitTypes = [...DEFAULT_V2_UNIT_TYPES];
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

function normalizeV2OrgUnitCreatePayload(data = {}) {
  return {
    code: data.code,
    name: data.name,
    unit_type: data.unit_type || data.unit_type_code || data.type || 'department',
    parent_unit_id: data.parent_unit_id || data.parentId || data.parent || null,
  };
}

async function createV2OrgUnit(data = {}) {
  const { signal, ...payload } = data;
  const response = await v2Api.postAdminOrgUnits(
    normalizeV2OrgUnitCreatePayload(payload),
    { signal },
  );
  return adaptV2OrgUnit(response?.data || response || {});
}

function buildV2OrgTree(units) {
  const byId = new Map(units.map((unit) => [unit.id, { ...unit, children: [] }]));
  const roots = [];

  for (const node of byId.values()) {
    const parentId = node.parentId || node.parent_unit_id;
    const parent = parentId ? byId.get(parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function getV2OrgUnit(id, options = {}) {
  const response = await v2Api.getAdminOrgUnitById({ id }, options);
  return adaptV2OrgUnit(response?.data || response || {});
}

async function getV2OrgUnitChildren(id, params = {}, options = {}) {
  const { queryParams, requestOptions } = splitRequestParams(params, options);
  const response = await v2Api.getAdminOrgUnitChildren({
    id,
  }, {
    query: {
      cursor: queryParams.cursor,
      limit: normalizeV2OrgLimit(queryParams),
    },
    signal: requestOptions.signal,
  });
  return Array.isArray(response?.data)
    ? response.data.map(adaptV2OrgUnit)
    : [];
}

async function getV2OrgUnitAncestors(id, params = {}, options = {}) {
  const { queryParams, requestOptions } = splitRequestParams(params, options);
  const response = await v2Api.getAdminOrgUnitAncestors({
    id,
  }, {
    query: {
      limit: normalizeV2OrgLimit(queryParams),
    },
    signal: requestOptions.signal,
  });
  return Array.isArray(response?.data)
    ? response.data.map(adaptV2OrgUnit)
    : [];
}

async function getV2OrgUnitDescendants(id, params = {}, options = {}) {
  const { queryParams, requestOptions } = splitRequestParams(params, options);
  const response = await v2Api.getAdminOrgUnitDescendants({
    id,
  }, {
    query: {
      cursor: queryParams.cursor,
      limit: normalizeV2OrgLimit(queryParams),
    },
    signal: requestOptions.signal,
  });
  return Array.isArray(response?.data)
    ? response.data.map(adaptV2OrgUnit)
    : [];
}

async function getV2OrgUnitWards(id, options = {}) {
  const descendants = await getV2OrgUnitDescendants(id, {}, options);
  return descendants.filter((unit) => unit.unit_type_code === 'ward' || unit.unit_type === 'ward');
}

function emptyRustV2List() {
  return Promise.resolve([]);
}

function emptyRustV2Object() {
  return Promise.resolve({});
}

function emptyRustV2Paginated() {
  return Promise.resolve({
    count: 0,
    next: null,
    previous: null,
    results: [],
  });
}

function unsupportedInRustV2(message) {
  return Promise.reject(new Error(message));
}

function unsupportedRustV2Resource(resourceName) {
  return unsupportedInRustV2(`Rust V2 does not expose ${resourceName} yet.`);
}

function legacyCrudApi(resourceName, basePath, { rustList = emptyRustV2List } = {}) {
  return {
    list: (params = {}) => {
      if (isRustV2ApiMode()) {
        return rustList(params);
      }
      return apiClient.get(basePath, { params });
    },
    get: (id) => {
      if (isRustV2ApiMode()) {
        return unsupportedRustV2Resource(`${resourceName} detail`);
      }
      return apiClient.get(`${basePath}${id}/`);
    },
    create: (data) => {
      if (isRustV2ApiMode()) {
        return unsupportedRustV2Resource(resourceName);
      }
      return apiClient.post(basePath, data);
    },
    update: (id, data) => {
      if (isRustV2ApiMode()) {
        return unsupportedRustV2Resource(resourceName);
      }
      return apiClient.patch(`${basePath}${id}/`, data);
    },
    patch: (id, data) => {
      if (isRustV2ApiMode()) {
        return unsupportedRustV2Resource(resourceName);
      }
      return apiClient.patch(`${basePath}${id}/`, data);
    },
    delete: (id) => {
      if (isRustV2ApiMode()) {
        return unsupportedRustV2Resource(resourceName);
      }
      return apiClient.delete(`${basePath}${id}/`);
    },
  };
}

// =============================================================================
// Configuration Endpoints
// =============================================================================

/**
 * Unit Types API
 */
export const unitTypesApi = {
  list: (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return listV2UnitTypes(params, options);
    }
    const { queryParams, requestOptions } = splitRequestParams(params, options);
    return apiClient.get('/organization/unit-types/', { params: queryParams, ...requestOptions });
  },
  get: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      const unitTypes = await listV2UnitTypes({}, options);
      return unitTypes.find((unitType) => unitType.id === id || unitType.code === id) || null;
    }
    return apiClient.get(`/organization/unit-types/${id}/`, options);
  },
  create: (data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('unit types');
    }
    return apiClient.post('/organization/unit-types/', data);
  },
  update: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('unit types');
    }
    return apiClient.patch(`/organization/unit-types/${id}/`, data);
  },
  patch: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('unit types');
    }
    return apiClient.patch(`/organization/unit-types/${id}/`, data);
  },
  delete: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('unit types');
    }
    return apiClient.delete(`/organization/unit-types/${id}/`);
  },
};

/**
 * Leadership Roles API
 */
export const leadershipRolesApi = legacyCrudApi('leadership roles', '/organization/leadership-roles/');

/**
 * Assignment Types API
 */
export const assignmentTypesApi = legacyCrudApi('assignment types', '/organization/assignment-types/');

// =============================================================================
// Clinical Units Endpoints
// =============================================================================

/**
 * Clinical Units API
 */
export const clinicalUnitsApi = {
  list: (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return listV2OrgUnits(params, options);
    }
    const { queryParams, requestOptions } = splitRequestParams(params, options);
    return apiClient.get('/organization/units/', { params: queryParams, ...requestOptions });
  },
  get: (id, options = {}) => {
    if (isRustV2ApiMode()) {
      return getV2OrgUnit(id, options);
    }
    return apiClient.get(`/organization/units/${id}/`, options);
  },
  create: (data) => {
    if (isRustV2ApiMode()) {
      return createV2OrgUnit(data);
    }
    return apiClient.post('/organization/units/', data);
  },
  update: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('organization unit updates');
    }
    return apiClient.patch(`/organization/units/${id}/`, data);
  },
  patch: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('organization unit updates');
    }
    return apiClient.patch(`/organization/units/${id}/`, data);
  },
  delete: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('organization unit deletion');
    }
    return apiClient.delete(`/organization/units/${id}/`);
  },

  // Tree and hierarchy
  tree: (options = {}) => {
    if (isRustV2ApiMode()) {
      return listV2OrgUnits({}, options).then(buildV2OrgTree);
    }
    return apiClient.get('/organization/units/tree/', options);
  },
  children: (id, params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return getV2OrgUnitChildren(id, params, options);
    }
    const { queryParams, requestOptions } = splitRequestParams(params, options);
    return apiClient.get(`/organization/units/${id}/children/`, { params: queryParams, ...requestOptions });
  },
  ancestors: (id, params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return getV2OrgUnitAncestors(id, params, options);
    }
    const { queryParams, requestOptions } = splitRequestParams(params, options);
    return apiClient.get(`/organization/units/${id}/ancestors/`, { params: queryParams, ...requestOptions });
  },
  descendants: (id, params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return getV2OrgUnitDescendants(id, params, options);
    }
    const { queryParams, requestOptions } = splitRequestParams(params, options);
    return apiClient.get(`/organization/units/${id}/descendants/`, { params: queryParams, ...requestOptions });
  },

  // Related data
  leaders: (id) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get(`/organization/units/${id}/leaders/`);
  },
  staff: (id, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    const queryString = new URLSearchParams(params).toString();
    return apiClient.get(`/organization/units/${id}/staff/${queryString ? `?${queryString}` : ''}`);
  },
  staffCounts: (id, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2Object();
    }
    const queryString = new URLSearchParams(params).toString();
    return apiClient.get(`/organization/units/${id}/staff/counts/${queryString ? `?${queryString}` : ''}`);
  },
  staffPaginated: (id, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2Paginated();
    }
    const queryString = new URLSearchParams(params).toString();
    return apiClient.getWithPagination(`/organization/units/${id}/staff/${queryString ? `?${queryString}` : ''}`);
  },
  members: (id, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    const queryString = new URLSearchParams(params).toString();
    return apiClient.get(`/organization/units/${id}/members/${queryString ? `?${queryString}` : ''}`);
  },
  membersCounts: (id, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2Object();
    }
    const queryString = new URLSearchParams(params).toString();
    return apiClient.get(`/organization/units/${id}/members/counts/${queryString ? `?${queryString}` : ''}`);
  },
  membersPaginated: (id, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2Paginated();
    }
    const queryString = new URLSearchParams(params).toString();
    return apiClient.getWithPagination(`/organization/units/${id}/members/${queryString ? `?${queryString}` : ''}`);
  },
  wards: (id, options = {}) => {
    if (isRustV2ApiMode()) {
      return getV2OrgUnitWards(id, options);
    }
    return apiClient.get(`/organization/units/${id}/wards/`, options);
  },
  coverage: (id) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2Object();
    }
    return apiClient.get(`/organization/units/${id}/coverage/`);
  },
};

// =============================================================================
// Leadership Assignments Endpoints
// =============================================================================

/**
 * Unit Leadership API
 */
export const leadershipApi = legacyCrudApi('leadership assignments', '/organization/leadership/');

// =============================================================================
// Staff Assignments Endpoints
// =============================================================================

/**
 * Staff Unit Assignments API
 */
export const staffAssignmentsApi = legacyCrudApi('staff assignments', '/organization/staff-assignments/');

/**
 * Ops Unit Member Assignments API
 */
export const unitMembersApi = legacyCrudApi('unit member assignments', '/organization/unit-members/');

// =============================================================================
// Cross Coverage Endpoints
// =============================================================================

/**
 * Cross Coverage Schedules API
 */
export const crossCoverageApi = legacyCrudApi('cross coverage schedules', '/organization/cross-coverage/');

// =============================================================================
// Ward Allocations Endpoints
// =============================================================================

/**
 * Unit Ward Allocations API
 */
export const wardAllocationsApi = legacyCrudApi('ward allocations', '/organization/ward-allocations/');

// =============================================================================
// Department Roster Endpoints
// =============================================================================

export const departmentDutyTypesApi = legacyCrudApi('department duty types', '/organization/department-duty-types/');

export const departmentStationsApi = legacyCrudApi('department stations', '/organization/department-stations/');

export const departmentRosterPlansApi = {
  ...legacyCrudApi('department roster plans', '/organization/department-roster-plans/'),
  importPreview: (data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('department roster plan imports');
    }
    return apiClient.post('/organization/department-roster-plans/import/preview/', data);
  },
  importApply: (data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('department roster plan imports');
    }
    return apiClient.post('/organization/department-roster-plans/import/apply/', data);
  },
};

export const departmentRosterPatternsApi = legacyCrudApi('department roster patterns', '/organization/department-roster-patterns/');

export const rosterPatternSlotsApi = legacyCrudApi('department roster slots', '/organization/department-roster-slots/');

export const rosterOverridesApi = legacyCrudApi('roster overrides', '/organization/department-roster-overrides/');

export const teamRosterPlansApi = legacyCrudApi('team roster plans', '/organization/team-roster-plans/');

export const teamRosterEntriesApi = {
  ...legacyCrudApi('team roster entries', '/organization/team-roster-entries/'),
  importPreview: (data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('team roster entry imports');
    }
    return apiClient.post('/organization/team-roster-entries/import/preview/', data);
  },
  importApply: (data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('team roster entry imports');
    }
    return apiClient.post('/organization/team-roster-entries/import/apply/', data);
  },
};

// =============================================================================
// Duty Roster Endpoints
// =============================================================================

/**
 * Shift Definitions API
 */
export const shiftDefinitionsApi = legacyCrudApi('shift definitions', '/organization/shift-definitions/');

/**
 * Duty Roster Templates API
 */
export const dutyRosterTemplatesApi = legacyCrudApi('duty roster templates', '/organization/duty-roster-templates/');

/**
 * Duty Roster API
 */
export const dutyRosterApi = {
  ...legacyCrudApi('duty roster entries', '/organization/duty-roster/'),
  generate: (data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('duty roster generation');
    }
    return apiClient.post('/organization/duty-roster/generate/', data);
  },
  swap: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('duty roster swaps');
    }
    return apiClient.post(`/organization/duty-roster/${id}/swap/`, data);
  },
  onDuty: (params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get('/organization/duty-roster/on-duty/', { params });
  },
};

// =============================================================================
// Simplified Roster Endpoints (per ROSTER_MANAGEMENT_SPEC.md)
// =============================================================================

/**
 * Rotation Rules API - Department-scoped
 */
export const rotationRulesApi = {
  list: (departmentId, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get(`/organization/departments/${departmentId}/rotation-rules/`, { params });
  },
  get: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('rotation rules detail');
    }
    return apiClient.get(`/organization/rotation-rules/${id}/`);
  },
  create: (departmentId, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('rotation rules');
    }
    return apiClient.post(`/organization/departments/${departmentId}/rotation-rules/`, { ...data, department: departmentId });
  },
  update: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('rotation rules');
    }
    return apiClient.patch(`/organization/rotation-rules/${id}/`, data);
  },
  delete: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('rotation rules');
    }
    return apiClient.delete(`/organization/rotation-rules/${id}/`);
  },
};

/**
 * Roster Entries API - Department-scoped simplified roster
 */
export const rosterEntriesApi = {
  list: (departmentId, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get(`/organization/departments/${departmentId}/roster/`, { params });
  },
  get: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster entries detail');
    }
    return apiClient.get(`/organization/roster/${id}/`);
  },
  create: (departmentId, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster entries');
    }
    return apiClient.post(`/organization/departments/${departmentId}/roster/`, data);
  },
  update: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster entries');
    }
    return apiClient.patch(`/organization/roster/${id}/`, data);
  },
  delete: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster entries');
    }
    return apiClient.delete(`/organization/roster/${id}/`);
  },
  generate: (departmentId, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster entries');
    }
    return apiClient.post(`/organization/departments/${departmentId}/roster/generate/`, data);
  },
  bulk: (departmentId, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster entries');
    }
    return apiClient.post(`/organization/departments/${departmentId}/roster/bulk/`, data);
  },
  importCsv: (departmentId, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster imports');
    }
    return apiClient.post(`/organization/departments/${departmentId}/roster/import/`, data);
  },
  publish: (departmentId, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster publishing');
    }
    return apiClient.post(`/organization/departments/${departmentId}/roster/publish/`, data);
  },
  clear: (departmentId, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster clearing');
    }
    return apiClient.post(`/organization/departments/${departmentId}/roster/clear/`, data);
  },
  override: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster overrides');
    }
    return apiClient.post(`/organization/roster/${id}/override/`, data);
  },
  print: (departmentId, params = {}) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('roster print export');
    }
    return apiClient.get(`/organization/departments/${departmentId}/roster/print/`, {
      params,
      responseType: 'blob',
    });
  },
  onDutyDepartment: (departmentId, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get(`/organization/departments/${departmentId}/on-duty/`, { params });
  },
  onDutyAll: (params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get(`/organization/on-duty/`, { params });
  },
};

/**
 * Roster Validation Rules API
 */
export const validationRulesApi = {
  list: (departmentId, params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get(`/organization/departments/${departmentId}/validation-rules/`, { params });
  },
  get: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('validation rules detail');
    }
    return apiClient.get(`/organization/validation-rules/${id}/`);
  },
  create: (departmentId, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('validation rules');
    }
    return apiClient.post(`/organization/departments/${departmentId}/validation-rules/`, { ...data, department: departmentId });
  },
  update: (id, data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('validation rules');
    }
    return apiClient.patch(`/organization/validation-rules/${id}/`, data);
  },
  delete: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('validation rules');
    }
    return apiClient.delete(`/organization/validation-rules/${id}/`);
  },
  templates: () => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get(`/organization/validation-rules/templates/`);
  },
  validate: (data) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('validation rule execution');
    }
    return apiClient.post(`/organization/validation-rules/validate/`, data);
  },
};

// =============================================================================
// Clinics Endpoints
// =============================================================================

/**
 * Clinics API
 */
export const clinicsApi = {
  list: (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      return listV2Clinics(params, options);
    }
    const { queryParams, requestOptions } = splitRequestParams(params, options);
    return apiClient.get('/organization/clinics/', { params: queryParams, ...requestOptions });
  },
  get: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      return getV2Clinic(id, options);
    }
    return apiClient.get(`/organization/clinics/${id}/`, options);
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
  list: (params = {}) => {
    if (isRustV2ApiMode()) {
      return emptyRustV2List();
    }
    return apiClient.get('/organization/clinic-schedules/', { params });
  },
  get: (id) => {
    if (isRustV2ApiMode()) {
      return unsupportedRustV2Resource('clinic schedules detail');
    }
    return apiClient.get(`/organization/clinic-schedules/${id}/`);
  },
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
