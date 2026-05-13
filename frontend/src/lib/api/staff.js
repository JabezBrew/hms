import { apiClient, handleApiError } from '../api-client';
import { v2Api } from './v2/client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';

const DEFAULT_STAFF_LIST_LIMIT = 25;
const MAX_STAFF_LIST_LIMIT = 100;

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, MAX_STAFF_LIST_LIMIT);
}

function getStaffListQuery(params = {}) {
  const limit = normalizePositiveInteger(
    params.limit ?? params.page_size ?? params.pageSize,
    DEFAULT_STAFF_LIST_LIMIT,
  );
  const cursor = params.cursor ?? params.next_cursor;
  return {
    limit,
    ...(cursor ? { cursor } : {}),
  };
}

function splitDisplayName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function adaptV2StaffListItem(item = {}) {
  const displayName = item.display_name || item.name || item.email || 'Unknown Staff';
  const { firstName, lastName } = splitDisplayName(displayName);
  const isActive = item.is_active ?? true;
  const userType = item.user_type || 'staff';

  return {
    ...item,
    id: item.id,
    user_id: item.user_id,
    name: displayName,
    email: item.email || '',
    employee_id: item.employee_id || '',
    department: item.department || '',
    position: item.position || '',
    is_active: isActive,
    user_type: userType,
    user_details: {
      id: item.user_id,
      first_name: firstName,
      last_name: lastName,
      email: item.email || '',
      user_type: userType,
      is_active: isActive,
    },
  };
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function normalizeV2StaffCreatePayload(data = {}) {
  const displayName = data.display_name
    || [data.first_name, data.last_name].filter(Boolean).join(' ').trim()
    || data.name
    || data.email;

  const practitionerProfile = data.practitioner_profile
    ?? (
      data.license_number || data.specialization || data.qualification
        ? compactObject({
          license_number: data.license_number,
          specialization: data.specialization,
          qualification: data.qualification,
        })
        : undefined
    );

  return compactObject({
    email: data.email,
    display_name: displayName,
    temporary_password: data.temporary_password || data.temp_password || data.password,
    employee_id: data.employee_id,
    department: data.department,
    position: data.position,
    hire_date: data.hire_date,
    practitioner_profile: practitionerProfile,
  });
}

function normalizeV2StaffUpdatePayload(data = {}) {
  const displayName = data.display_name
    ?? data.name
    ?? ([data.first_name, data.last_name].filter(Boolean).join(' ').trim() || undefined);

  return compactObject({
    display_name: displayName,
    department: data.department,
    position: data.position,
  });
}

function adaptV2StaffLifecycleResponse(response, mode, detail) {
  return {
    mode,
    detail,
    staff: adaptV2StaffListItem(response?.data || {}),
  };
}

function adaptV2PractitionerListItem(item = {}) {
  const displayName = item.display_name || item.name || 'Unknown Practitioner';
  const { firstName, lastName } = splitDisplayName(displayName);
  return {
    ...item,
    id: item.id,
    staff: item.staff_id,
    staff_id: item.staff_id,
    user_id: item.user_id,
    name: displayName,
    employee_id: item.employee_id || '',
    license_number: item.license_number || '',
    specialization: item.specialization || '',
    qualification: item.qualification || '',
    is_active: item.is_active ?? true,
    user_details: {
      id: item.user_id,
      first_name: firstName,
      last_name: lastName,
      user_type: 'doctor',
      is_active: item.is_active ?? true,
    },
  };
}

function practitionerMatchesQuery(practitioner, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    practitioner.name,
    practitioner.employee_id,
    practitioner.license_number,
    practitioner.specialization,
    practitioner.qualification,
  ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
}

function staffMatchesQuery(staff, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    staff.name,
    staff.email,
    staff.employee_id,
    staff.department,
    staff.position,
    staff.user_type,
  ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
}

function staffMatchesFilters(staff, filters = {}) {
  if (!filters.includeInactive && staff.is_active === false) {
    return false;
  }

  if (filters.staffKind) {
    const staffKind = staff.staff_kind || staff.staffKind || staff.kind || '';
    if (String(staffKind).toLowerCase() !== String(filters.staffKind).toLowerCase()) {
      return false;
    }
  }

  if (filters.practitionersOnly && !staff.practitioner_profile) {
    return false;
  }

  if (filters.userTypes) {
    const requested = Array.isArray(filters.userTypes)
      ? filters.userTypes
      : String(filters.userTypes).split(',');
    const normalized = requested.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
    if (normalized.length > 0 && !normalized.includes(String(staff.user_type || '').toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Staff API service
 */
export const staffApi = {
  /**
   * Get all staff members with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of staff members
   */
  getStaff: async (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.getAdminStaff({
          query: getStaffListQuery(params),
          signal: options.signal,
        });
        return Array.isArray(response?.data)
          ? response.data.map(adaptV2StaffListItem)
          : [];
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to fetch staff members'));
      }
    }

    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/users/staff/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint, options);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch staff members'));
    }
  },

  /**
   * Get a single staff member by ID
   * @param {string} id - Staff ID
   * @returns {Promise<Object>} Staff data
   */
  getStaffMember: async (id) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.getAdminStaffById({ id });
        return adaptV2StaffListItem(response?.data);
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to fetch staff member'));
      }
    }

    try {
      return await apiClient.get(`/users/staff/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch staff member'));
    }
  },

  /**
   * Create a new staff member
   * @param {Object} data - Staff data
   * @returns {Promise<Object>} Created staff data
   */
  createStaff: async (data) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.postAdminStaff(normalizeV2StaffCreatePayload(data));
        return adaptV2StaffListItem(response?.data);
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to create staff member'));
      }
    }

    try {
      return await apiClient.post('/users/staff/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create staff member'));
    }
  },

  /**
   * Update a staff member
   * @param {string} id - Staff ID
   * @param {Object} data - Staff data to update
   * @returns {Promise<Object>} Updated staff data
   */
  updateStaff: async (id, data, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.patchAdminStaff(
          { id },
          normalizeV2StaffUpdatePayload(data),
          { signal: options.signal },
        );
        return adaptV2StaffListItem(response?.data);
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to update staff member'));
      }
    }

    try {
      return await apiClient.patch(`/users/staff/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update staff member'));
    }
  },

  /**
   * Delete a staff member
   * @param {string} id - Staff ID
   * @returns {Promise<void>}
   */
  deleteStaff: async (id) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.postAdminStaffDeactivate({ id });
        return adaptV2StaffListItem(response?.data);
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to deactivate staff member'));
      }
    }

    try {
      return await apiClient.delete(`/users/staff/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete staff member'));
    }
  },

  /**
   * Register a new staff member with FHIR resource creation for practitioners
   * @param {Object} data - Staff registration data
   * @returns {Promise<Object>} Registered staff data
   */
  registerStaff: async (data) => {
    if (isRustV2ApiMode()) {
      return staffApi.createStaff(data);
    }

    try {
      return await apiClient.post('/users/staff/register/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to register staff member'));
    }
  },

  /**
   * Reactivate a deprovisioned staff account and send a setup/reset link
   * @param {string} staffId - Staff ID
   * @returns {Promise<Object>} API response with mode, detail, and staff
   */
  reactivateStaff: async (staffId) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.postAdminStaffReactivate({ id: staffId });
        return adaptV2StaffLifecycleResponse(
          response,
          'password_reset',
          'Staff account reactivated and password reset required.',
        );
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to reactivate staff account'));
      }
    }

    try {
      return await apiClient.post(`/users/staff/${staffId}/reactivate/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to reactivate staff account'));
    }
  },

  /**
   * Resend account setup/reset link for an existing staff account
   * @param {string} staffId - Staff ID
   * @returns {Promise<Object>} API response with mode and detail
   */
  resendSetupLink: async (staffId) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.postAdminStaffForcePasswordReset({ id: staffId });
        return adaptV2StaffLifecycleResponse(
          response,
          'password_reset',
          'Password reset link sent successfully.',
        );
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to resend setup link'));
      }
    }

    try {
      return await apiClient.post(`/users/staff/${staffId}/resend-setup-link/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to resend setup link'));
    }
  },

  /**
   * Get practitioners (doctors, nurses)
   * @returns {Promise<Array>} List of practitioners
   */
  getPractitioners: async (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.getAdminPractitioners({
          query: getStaffListQuery(params),
          signal: options.signal || params.signal,
        });
        return Array.isArray(response?.data)
          ? response.data.map(adaptV2PractitionerListItem)
          : [];
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to fetch practitioners'));
      }
    }

    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/users/practitioners/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch practitioners'));
    }
  },

  /**
   * Search practitioners by name, employee number, or license number
   * @param {string} query - Search query
   * @param {boolean} doctorsOnly - Whether to filter for doctors only
   * @returns {Promise<Array>} List of matching practitioners
   */
  searchPractitioners: async (query, doctorsOnly = false) => {
    try {
      if (!query || query.length < 2) {
        return [];
      }

      if (isRustV2ApiMode()) {
        const practitioners = await staffApi.getPractitioners({ limit: 100 });
        return practitioners.filter((practitioner) => practitionerMatchesQuery(practitioner, query));
      }

      const params = new URLSearchParams({
        q: query
      });

      if (doctorsOnly) {
        params.append('doctors_only', 'true');
      }

      const response = await apiClient.get(`/users/practitioners/search/?${params.toString()}`);

      // Handle the response structure which includes a "practitioners" array
      // Each item has { fhir_resource, local_data } - we need to flatten to simple objects
      if (response && response.practitioners) {
        return response.practitioners.map(p => {
          const localData = p.local_data || {};
          const userDetails = localData.staff_details?.user_details || {};
          return {
            id: localData.id,
            name: `${userDetails.first_name || ''} ${userDetails.last_name || ''}`.trim() || 'Unknown',
            email: userDetails.email,
            user_type: userDetails.user_type,
            department: localData.staff_details?.department,
            specialization: localData.specialization,
            license_number: localData.license_number,
            qualification: localData.qualification,
            staff: localData.staff,
          };
        });
      }

      // Fallback to the old response structure for backward compatibility
      return Array.isArray(response) ? response : [];
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to search practitioners'));
    }
  },

  /**
   * Search staff by name or employee ID
   * @param {string} query - Search query
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} List of matching staff
   */
  searchStaff: async (query, filters = {}) => {
    try {
      if (!query || query.length < 2) {
        return [];
      }

      if (isRustV2ApiMode()) {
        const staff = await staffApi.getStaff(
          { limit: 100 },
          { signal: filters.signal },
        );
        return staff.filter((member) => (
          staffMatchesQuery(member, query) && staffMatchesFilters(member, filters)
        ));
      }

      const params = new URLSearchParams({ q: query });

      if (filters.staffKind) {
        params.append('staff_kind', filters.staffKind);
      }
      if (filters.practitionersOnly) {
        params.append('practitioners_only', 'true');
      }
      if (filters.userTypes) {
        const userTypes = Array.isArray(filters.userTypes)
          ? filters.userTypes.join(',')
          : filters.userTypes;
        if (userTypes) {
          params.append('user_type', userTypes);
        }
      }
      if (filters.includeInactive) {
        params.append('include_inactive', 'true');
      }

      return await apiClient.get(`/users/staff/search/?${params.toString()}`);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to search staff'));
      }
      throw new Error(handleApiError(error, 'Failed to search staff'));
    }
  },

  /**
   * Get a single practitioner by ID
   * @param {string} id - Practitioner ID
   * @returns {Promise<Object>} Practitioner data
   */
  getPractitioner: async (id, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.getAdminPractitionerById(
          { id },
          { signal: options.signal },
        );
        return adaptV2PractitionerListItem(response?.data || {});
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw error;
        }
        throw new Error(handleV2ApiError(error, 'Failed to fetch practitioner'));
      }
    }

    try {
      return await apiClient.get(`/users/practitioners/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch practitioner'));
    }
  }
};
