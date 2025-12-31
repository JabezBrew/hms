/**
 * Organization API client for managing clinical units and organizational hierarchy.
 */
import { apiClient } from '../api-client';

// =============================================================================
// Configuration Endpoints
// =============================================================================

/**
 * Unit Types API
 */
export const unitTypesApi = {
  list: (params = {}) => apiClient.get('/organization/unit-types/', { params }),
  get: (id) => apiClient.get(`/organization/unit-types/${id}/`),
  create: (data) => apiClient.post('/organization/unit-types/', data),
  update: (id, data) => apiClient.put(`/organization/unit-types/${id}/`, data),
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
  update: (id, data) => apiClient.put(`/organization/leadership-roles/${id}/`, data),
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
  update: (id, data) => apiClient.put(`/organization/assignment-types/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/assignment-types/${id}/`),
};

// =============================================================================
// Clinical Units Endpoints
// =============================================================================

/**
 * Clinical Units API
 */
export const clinicalUnitsApi = {
  list: (params = {}) => apiClient.get('/organization/units/', { params }),
  get: (id) => apiClient.get(`/organization/units/${id}/`),
  create: (data) => apiClient.post('/organization/units/', data),
  update: (id, data) => apiClient.put(`/organization/units/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/units/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/units/${id}/`),

  // Tree and hierarchy
  tree: () => apiClient.get('/organization/units/tree/'),
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
  update: (id, data) => apiClient.put(`/organization/leadership/${id}/`, data),
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
  update: (id, data) => apiClient.put(`/organization/staff-assignments/${id}/`, data),
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
  update: (id, data) => apiClient.put(`/organization/unit-members/${id}/`, data),
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
  update: (id, data) => apiClient.put(`/organization/cross-coverage/${id}/`, data),
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
  update: (id, data) => apiClient.put(`/organization/ward-allocations/${id}/`, data),
  patch: (id, data) => apiClient.patch(`/organization/ward-allocations/${id}/`, data),
  delete: (id) => apiClient.delete(`/organization/ward-allocations/${id}/`),
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
};
