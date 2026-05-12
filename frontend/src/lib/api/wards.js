import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api } from './v2/client';

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function normalizeListResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function normalizeV2Limit(params = {}, fallback = 100) {
  const rawLimit = params.limit || params.page_size || fallback;
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function adaptV2Ward(ward) {
  const totalBeds = Number(ward.active_bed_count || 0);
  const occupiedBeds = Number(ward.occupied_bed_count || 0);
  const availableBeds = Math.max(totalBeds - occupiedBeds, 0);
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  return {
    ...ward,
    ward_type: ward.ward_type || ward.code || 'ward',
    description: ward.description || '',
    total_beds: totalBeds,
    available_beds_count: availableBeds,
    occupied_beds_count: occupiedBeds,
    occupancy_rate: occupancyRate,
    is_active: ward.status === 'active',
  };
}

function adaptV2Bed(bed) {
  return {
    ...bed,
    bed_number: bed.bed_number || bed.bed_code,
    name: bed.name || bed.bed_code,
    ward: bed.ward || bed.ward_id,
    section: bed.section || bed.section_id,
    is_active: bed.status !== 'closed',
  };
}

function v2ListData(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

function rethrowV2Error(error, message) {
  rethrowAbortError(error);
  throw new Error(handleV2ApiError(error, message));
}

/**
 * Wards API service
 */
export const wardsApi = {
  /**
   * Get wards API root information
   * @returns {Promise<Object>} API root information with links to resources
   */
  getWardsRoot: async () => {
    try {
      return await apiClient.get('/wards/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch wards API information'));
    }
  },

  /**
   * Get all wards with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of wards
   */
  getWards: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWards({
          query: {
            cursor: params.cursor,
            limit: normalizeV2Limit(params),
          },
          signal: params.signal,
        });
        return v2ListData(response).map(adaptV2Ward);
      }
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/wards/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch wards');
      }
      throw new Error(handleApiError(error, 'Failed to fetch wards'));
    }
  },

  /**
   * Search wards by name for picker UIs
   * @param {string} query - Search query
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} List of matching wards
   */
  searchWards: async (query, filters = {}) => {
    try {
      if (!query || query.length < 2) {
        return [];
      }

      if (isRustV2ApiMode()) {
        const term = String(query).trim().toLowerCase();
        const response = await v2Api.getWards({
          query: {
            limit: normalizeV2Limit(filters, 50),
          },
          signal: filters.signal,
        });
        return v2ListData(response)
          .map(adaptV2Ward)
          .filter((ward) => (
            ward.name?.toLowerCase().includes(term)
            || ward.code?.toLowerCase().includes(term)
            || ward.ward_type?.toLowerCase().includes(term)
          ));
      }

      const params = new URLSearchParams({ q: query });

      if (filters.wardType) {
        params.append('ward_type', filters.wardType);
      }
      if (filters.department) {
        params.append('department', filters.department);
      }
      if (filters.includeInactive) {
        params.append('include_inactive', 'true');
      }

      return await apiClient.get(`/wards/wards/search/?${params.toString()}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to search wards');
      }
      throw new Error(handleApiError(error, 'Failed to search wards'));
    }
  },

  /**
   * Get a single ward by ID
   * @param {string} id - Ward ID
   * @returns {Promise<Object>} Ward data
   */
  getWard: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardById({ id });
        return adaptV2Ward(response?.data || {});
      }
      return await apiClient.get(`/wards/wards/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch ward');
      }
      throw new Error(handleApiError(error, 'Failed to fetch ward'));
    }
  },

  /**
   * Create a new ward (admin only)
   * @param {Object} data - Ward data
   * @returns {Promise<Object>} Created ward data
   */
  createWard: async (data) => {
    try {
      return await apiClient.post('/wards/wards/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create ward'));
    }
  },

  /**
   * Update a ward (admin only)
   * @param {string} id - Ward ID
   * @param {Object} data - Ward data to update
   * @returns {Promise<Object>} Updated ward data
   */
  updateWard: async (id, data) => {
    try {
      return await apiClient.patch(`/wards/wards/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update ward'));
    }
  },

  /**
   * Delete a ward (admin only)
   * @param {string} id - Ward ID
   * @returns {Promise<void>}
   */
  deleteWard: async (id) => {
    try {
      return await apiClient.delete(`/wards/wards/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete ward'));
    }
  },

  /**
   * Get all beds with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of beds
   */
  getBeds: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        if (!params.ward) {
          return [];
        }
        const response = await v2Api.getWardBeds(
          { id: params.ward },
          {
            query: {
              cursor: params.cursor,
              limit: normalizeV2Limit(params, 100),
            },
            signal: params.signal,
          },
        );
        return v2ListData(response).map(adaptV2Bed);
      }
      // Check if ward parameter is provided
      if (params.ward) {
        // Use the nested endpoint for a specific ward
        const wardId = params.ward;

        // Remove ward from params since it's now part of the URL
        const { ward, ...restParams } = params;

        // Use page_size=all to get all beds without pagination
        const paramsWithPageSize = { ...restParams, page_size: 'all' };
        const queryString = new URLSearchParams(paramsWithPageSize).toString();
        const endpoint = `/wards/wards/${wardId}/beds/${queryString ? `?${queryString}` : ''}`;
        return await apiClient.get(endpoint);
      } else {
        // Use the general beds endpoint for all beds
        // Add a large page_size parameter to get all beds in a single request
        const paramsWithPageSize = { ...params, page_size: 1000 };
        const queryString = new URLSearchParams(paramsWithPageSize).toString();
        const endpoint = `/wards/beds/${queryString ? `?${queryString}` : ''}`;
        return await apiClient.get(endpoint);
      }
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch beds'));
    }
  },

  /**
   * Get a single bed by ID
   * @param {string} id - Bed ID
   * @returns {Promise<Object>} Bed data
   */
  getBed: async (id) => {
    try {
      return await apiClient.get(`/wards/beds/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch bed'));
    }
  },

  /**
   * Create a new bed (admin only)
   * @param {Object} data - Bed data
   * @returns {Promise<Object>} Created bed data
   */
  createBed: async (data) => {
    try {
      return await apiClient.post('/wards/beds/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create bed'));
    }
  },

  /**
   * Update a bed (admin only)
   * @param {string} id - Bed ID
   * @param {Object} data - Bed data to update
   * @returns {Promise<Object>} Updated bed data
   */
  updateBed: async (id, data) => {
    try {
      return await apiClient.patch(`/wards/beds/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update bed'));
    }
  },

  /**
   * Delete a bed (admin only)
   * @param {string} id - Bed ID
   * @returns {Promise<void>}
   */
  deleteBed: async (id) => {
    try {
      return await apiClient.delete(`/wards/beds/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete bed'));
    }
  },

  /**
   * Get all admissions with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of admissions
   */
  getAdmissions: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/wards/admissions/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch admissions'));
    }
  },

  /**
   * Get a single admission by ID
   * @param {string} id - Admission ID
   * @returns {Promise<Object>} Admission data
   */
  getAdmission: async (id) => {
    try {
      return await apiClient.get(`/wards/admissions/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch admission'));
    }
  },

  /**
   * Create a new admission
   * @param {Object} data - Admission data
   * @returns {Promise<Object>} Created admission data
   */
  createAdmission: async (data) => {
    try {
      return await apiClient.post('/wards/admissions/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create admission'));
    }
  },

  /**
   * Update an admission
   * @param {string} id - Admission ID
   * @param {Object} data - Admission data to update
   * @returns {Promise<Object>} Updated admission data
   */
  updateAdmission: async (id, data) => {
    try {
      return await apiClient.patch(`/wards/admissions/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update admission'));
    }
  },

  /**
   * Get all transfers with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of transfers
   */
  getTransfers: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/transfers/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch transfers'));
    }
  },

  /**
   * Create a new transfer
   * @param {Object} data - Transfer data
   * @returns {Promise<Object>} Created transfer data
   */
  createTransfer: async (data) => {
    try {
      return await apiClient.post('/wards/transfers/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create transfer'));
    }
  },

  /**
   * Get all allocation logs with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of allocation logs
   */
  getAllocationLogs: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/allocation-logs/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch allocation logs'));
    }
  },

  /**
   * Get ward analytics and reports
   * @param {Object} params - Query parameters (ward_id, start_date, end_date)
   * @returns {Promise<Object>} Analytics data including occupancy trends, length of stay, utilization, and admissions
   */
  getAnalytics: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/wards/analytics/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch ward analytics'));
    }
  },

  // =============================================================================
  // WARD SECTIONS
  // =============================================================================

  /**
   * Get all ward sections with optional filtering
   * @param {Object} params - Query parameters (ward, gender_restriction, accommodation_tier, is_isolation_capable, is_active)
   * @returns {Promise<Array>} List of ward sections
   */
  getSections: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/sections/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch ward sections'));
    }
  },

  /**
   * Get sections for a specific ward
   * @param {string} wardId - Ward ID
   * @returns {Promise<Array>} List of sections for the ward
   */
  getWardSections: async (wardId) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardSections({ id: wardId }, { query: { limit: 100 } });
        return v2ListData(response).map((section) => ({
          ...section,
          bed_count: section.active_bed_count || 0,
          available_beds_count: section.active_bed_count || 0,
          is_active: section.status === 'active',
          description: section.description || '',
        }));
      }
      return await apiClient.get(`/wards/sections/?ward=${wardId}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch ward sections');
      }
      throw new Error(handleApiError(error, 'Failed to fetch ward sections'));
    }
  },

  /**
   * Get a single section by ID
   * @param {string} id - Section ID
   * @returns {Promise<Object>} Section data
   */
  getSection: async (id) => {
    try {
      return await apiClient.get(`/wards/sections/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch section'));
    }
  },

  /**
   * Create a new ward section (admin only)
   * @param {Object} data - Section data
   * @returns {Promise<Object>} Created section data
   */
  createSection: async (data) => {
    try {
      return await apiClient.post('/wards/sections/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create section'));
    }
  },

  /**
   * Update a ward section (admin only)
   * @param {string} id - Section ID
   * @param {Object} data - Section data to update
   * @returns {Promise<Object>} Updated section data
   */
  updateSection: async (id, data) => {
    try {
      return await apiClient.patch(`/wards/sections/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update section'));
    }
  },

  /**
   * Delete a ward section (admin only)
   * @param {string} id - Section ID
   * @returns {Promise<void>}
   */
  deleteSection: async (id) => {
    try {
      return await apiClient.delete(`/wards/sections/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete section'));
    }
  },

  /**
   * Get beds in a specific section
   * @param {string} sectionId - Section ID
   * @returns {Promise<Array>} List of beds in the section
   */
  getSectionBeds: async (sectionId) => {
    try {
      return await apiClient.get(`/wards/sections/${sectionId}/beds/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch section beds'));
    }
  },

  // =============================================================================
  // BED AMENITIES
  // =============================================================================

  /**
   * Get all bed amenities with optional filtering
   * @param {Object} params - Query parameters (category, is_active, search)
   * @returns {Promise<Array>} List of bed amenities
   */
  getAmenities: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/amenities/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch bed amenities'));
    }
  },

  /**
   * Get a single amenity by ID
   * @param {string} id - Amenity ID
   * @returns {Promise<Object>} Amenity data
   */
  getAmenity: async (id) => {
    try {
      return await apiClient.get(`/wards/amenities/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch amenity'));
    }
  },

  /**
   * Create a new bed amenity (admin only)
   * @param {Object} data - Amenity data
   * @returns {Promise<Object>} Created amenity data
   */
  createAmenity: async (data) => {
    try {
      return await apiClient.post('/wards/amenities/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create amenity'));
    }
  },

  /**
   * Update a bed amenity (admin only)
   * @param {string} id - Amenity ID
   * @param {Object} data - Amenity data to update
   * @returns {Promise<Object>} Updated amenity data
   */
  updateAmenity: async (id, data) => {
    try {
      return await apiClient.patch(`/wards/amenities/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update amenity'));
    }
  },

  /**
   * Delete a bed amenity (admin only)
   * @param {string} id - Amenity ID
   * @returns {Promise<void>}
   */
  deleteAmenity: async (id) => {
    try {
      return await apiClient.delete(`/wards/amenities/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete amenity'));
    }
  },

  // =============================================================================
  // ENHANCED BED SELECTION
  // =============================================================================

  /**
   * Get available beds with advanced filtering
   * @param {Object} params - Query parameters:
   *   - ward: Ward ID
   *   - section: Section ID
   *   - gender: Patient gender (M/F) for automatic compatibility filtering
   *   - accommodation_tier: Tier (open, semi_private, private, vip)
   *   - isolation_capable: Boolean for isolation capability
   *   - amenities: Comma-separated amenity codes (e.g., "oxygen,cardiac_monitor")
   * @returns {Promise<Array>} List of available beds matching criteria
   */
  getAvailableBeds: async (params = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const beds = await wardsApi.getBeds(params);
        return beds.filter((bed) => bed.status === 'available');
      }
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/beds/available/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch available beds');
      }
      throw new Error(handleApiError(error, 'Failed to fetch available beds'));
    }
  },

  // =============================================================================
  // WARD STAFF ASSIGNMENTS
  // =============================================================================

  /**
   * Get staff assigned to a ward (lightweight, for dropdowns)
   * @param {string} wardId - Ward ID
   * @param {Object} params - Query parameters:
   *   - category: Filter by role category ('nursing', 'medical', 'allied')
   * @returns {Promise<Array>} List of staff assignments with id, full_name, role_name
   */
  getWardStaff: async (wardId, params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/wards/${wardId}/staff/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch ward staff'));
    }
  },

  /**
   * Get all staff assignments (detailed, for management UI)
   * @param {Object} params - Query parameters:
   *   - ward: Ward ID to filter by
   *   - practitioner: Practitioner ID to filter by
   *   - category: Role category to filter by
   *   - show_inactive: Include inactive assignments
   * @returns {Promise<Array>} List of detailed staff assignments
   */
  getStaffAssignments: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/staff-assignments/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch staff assignments'));
    }
  },

  /**
   * Get staff assignments by practitioner
   * @param {string} practitionerId - Practitioner ID
   * @returns {Promise<Array>} List of ward assignments for the practitioner
   */
  getStaffAssignmentsByPractitioner: async (practitionerId) => {
    try {
      return await apiClient.get(`/wards/staff-assignments/by_practitioner/?practitioner_id=${practitionerId}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch practitioner assignments'));
    }
  },

  /**
   * Get a single staff assignment by ID
   * @param {string} id - Assignment ID
   * @returns {Promise<Object>} Assignment data
   */
  getStaffAssignment: async (id) => {
    try {
      return await apiClient.get(`/wards/staff-assignments/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch staff assignment'));
    }
  },

  /**
   * Create a new staff assignment
   * @param {Object} data - Assignment data (ward, practitioner, role, is_active, is_primary)
   * @returns {Promise<Object>} Created assignment data
   */
  createStaffAssignment: async (data) => {
    try {
      return await apiClient.post('/wards/staff-assignments/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create staff assignment'));
    }
  },

  /**
   * Update a staff assignment
   * @param {string} id - Assignment ID
   * @param {Object} data - Assignment data to update
   * @returns {Promise<Object>} Updated assignment data
   */
  updateStaffAssignment: async (id, data) => {
    try {
      return await apiClient.patch(`/wards/staff-assignments/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update staff assignment'));
    }
  },

  /**
   * Delete a staff assignment
   * @param {string} id - Assignment ID
   * @returns {Promise<void>}
   */
  deleteStaffAssignment: async (id) => {
    try {
      return await apiClient.delete(`/wards/staff-assignments/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete staff assignment'));
    }
  },

  // =============================================================================
  // STAFF ROLES
  // =============================================================================

  /**
   * Get all staff roles
   * @param {Object} params - Query parameters:
   *   - category: Filter by category ('nursing', 'medical', 'allied')
   *   - show_inactive: Include inactive roles
   * @returns {Promise<Array>} List of staff roles
   */
  getStaffRoles: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/staff-roles/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch staff roles'));
    }
  },

  /**
   * Get a single staff role by ID
   * @param {string} id - Role ID
   * @returns {Promise<Object>} Role data
   */
  getStaffRole: async (id) => {
    try {
      return await apiClient.get(`/wards/staff-roles/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch staff role'));
    }
  },
};
