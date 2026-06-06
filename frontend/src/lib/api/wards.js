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
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function normalizeObjectResponse(response) {
  return response?.data && typeof response.data === 'object' ? response.data : response;
}

function normalizeV2Limit(params = {}, fallback = 100) {
  const rawLimit = params.limit || params.page_size || fallback;
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function deriveRustCodeFromName(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');

  return normalized || fallback;
}

function numberFrom(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function adaptV2Ward(ward) {
  const totalBeds = numberFrom(ward.active_bed_count);
  const occupiedBeds = numberFrom(ward.occupied_bed_count);
  const reservedBeds = numberFrom(ward.reserved_bed_count);
  const cleaningBeds = numberFrom(ward.cleaning_bed_count);
  const maintenanceBeds = ward.blocked_bed_count ?? ward.maintenance_bed_count ?? ward.closed_bed_count;
  const fallbackAvailableBeds = Math.max(totalBeds - occupiedBeds - reservedBeds - cleaningBeds, 0);
  const availableBeds = ward.available_bed_count === undefined || ward.available_bed_count === null
    ? fallbackAvailableBeds
    : numberFrom(ward.available_bed_count);
  const occupancyRate = totalBeds > 0 ? (occupiedBeds / totalBeds) * 100 : 0;

  return {
    ...ward,
    ward_type: ward.ward_type || ward.code || 'ward',
    description: ward.description || '',
    total_beds: totalBeds,
    available_beds_count: availableBeds,
    occupied_beds_count: occupiedBeds,
    reserved_beds_count: reservedBeds,
    cleaning_beds_count: cleaningBeds,
    maintenance_beds_count: maintenanceBeds === undefined || maintenanceBeds === null
      ? undefined
      : numberFrom(maintenanceBeds),
    occupancy_rate: occupancyRate,
    is_active: ward.status === 'active',
  };
}

function adaptV2Bed(bed) {
  const model = {
    ...bed,
    bed_number: bed.bed_number || bed.bed_code,
    name: bed.name || bed.bed_code,
    ward: bed.ward || bed.ward_id,
    section: bed.section || bed.section_id,
    is_active: bed.status !== 'closed',
  };
  if (bed.occupied_since !== undefined) {
    model.occupied_since = bed.occupied_since;
  }
  return model;
}

function v2AssignmentQuery(params = {}) {
  return {
    ...(params.cursor ? { cursor: params.cursor } : {}),
    ...(params.limit || params.page_size ? { limit: params.limit || params.page_size } : {}),
    ...(params.ward || params.ward_id ? { ward_id: params.ward || params.ward_id } : {}),
    ...(params.practitioner || params.practitioner_id
      ? { practitioner_id: params.practitioner || params.practitioner_id }
      : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.show_inactive !== undefined ? { show_inactive: params.show_inactive } : {}),
  };
}

function adaptV2StaffAssignment(item = {}) {
  return {
    ...item,
    ward: item.ward ?? item.ward_id,
    practitioner: item.practitioner ?? item.practitioner_id,
    role: item.role ?? item.role_code,
    role_id: item.role_id ?? item.role_code,
    practitioner_id: item.practitioner_id ?? item.practitioner,
    practitioner_name: item.practitioner_name || '',
    ward_name: item.ward_name || '',
    role_name: item.role_name || item.role_code || '',
  };
}

function adaptV2WardBoardAdmission(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || item.name || 'Unnamed patient';
  const bedLabel = item.bed_code || item.bed_number || '';
  const admissionId = item.admission_id || item.id;
  const status = item.admission_status || item.status;

  return {
    ...item,
    id: admissionId,
    admission_id: admissionId,
    patient_id: item.patient_id,
    patient_name: patientName,
    ward: item.ward_id,
    ward_id: item.ward_id,
    ward_name: item.ward_name || '',
    bed_id: item.bed_id ?? null,
    bed: item.bed_id
      ? {
          id: item.bed_id,
          bed_number: bedLabel,
          bed_code: bedLabel,
          name: bedLabel,
          ward: item.ward_id,
          ward_id: item.ward_id,
        }
      : null,
    status,
    admission_status: status,
    admitted_at: item.admitted_at,
    open_nursing_task_count: item.open_nursing_task_count ?? 0,
    due_medication_count: item.due_medication_count ?? 0,
    patient: {
      id: item.patient_id,
      medical_record_number: item.patient_code || '',
      patient_code: item.patient_code || '',
      name: patientName,
      display_name: patientName,
      user: {
        full_name: patientName,
      },
    },
  };
}

function adaptV2WardAnalytics(response = {}) {
  const data = response?.data || response || {};
  const occupancyByDate = new Map();
  const wardNameIds = new Map();
  for (const point of data.occupancy_trends || []) {
    const wardName = point.ward || 'Ward';
    const identifiers = wardNameIds.get(wardName) || new Set();
    identifiers.add(point.ward_id || wardName);
    wardNameIds.set(wardName, identifiers);
  }

  for (const point of data.occupancy_trends || []) {
    const date = point.date;
    if (!date) continue;
    const row = occupancyByDate.get(date) || {
      date,
      __occupiedBedDays: 0,
      __totalBeds: 0,
    };
    const wardName = point.ward || 'Ward';
    const wardLabel = wardNameIds.get(wardName)?.size > 1 && point.ward_id
      ? `${wardName} (${String(point.ward_id).slice(0, 8)})`
      : wardName;
    row.__wardLabels = {
      ...(row.__wardLabels || {}),
      [point.ward_id || wardName]: wardLabel,
    };
    row[wardLabel] = numberFrom(point.occupancy_rate);
    row.__occupiedBedDays += numberFrom(point.occupied_bed_days);
    row.__totalBeds += numberFrom(point.total_beds);
    occupancyByDate.set(date, row);
  }

  const occupancyTrends = [...occupancyByDate.values()].map((row) => {
    const { __occupiedBedDays, __totalBeds, ...chartRow } = row;
    chartRow.Overall = __totalBeds > 0 ? (__occupiedBedDays / __totalBeds) * 100 : 0;
    return chartRow;
  });

  return {
    meta: data.meta || null,
    occupancy_trends: occupancyTrends,
    length_of_stay: Array.isArray(data.length_of_stay) ? data.length_of_stay : [],
    ward_utilization: (data.ward_utilization || []).map((ward) => ({
      ward_id: ward.ward_id,
      ward: ward.ward,
      occupancy_rate: numberFrom(ward.occupancy_rate),
      occupied_beds_count: numberFrom(ward.occupied_beds_count),
      total_beds: numberFrom(ward.total_beds),
      turnover_rate: ward.turnover_rate ?? null,
      avg_los: ward.avg_los ?? null,
      bed_days: numberFrom(ward.bed_days),
    })),
    admissions_by_ward: (data.admissions_by_ward || []).map((ward) => ({
      ward_id: ward.ward_id,
      ward: ward.ward,
      admissions: numberFrom(ward.admissions),
      discharges: numberFrom(ward.discharges),
      transfers: ward.transfers ?? null,
    })),
  };
}

function v2ListData(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

function shouldUseWardBoardAdmissions(params = {}) {
  const status = String(params.status || '').toLowerCase();
  return Boolean(params.ward || params.ward_id) && (!status || status === 'admitted');
}

function rethrowV2Error(error, message) {
  rethrowAbortError(error);
  throw new Error(handleV2ApiError(error, message));
}

function rustV2Unsupported(resourceName) {
  return Promise.reject(new Error(`Rust V2 does not expose ${resourceName} yet.`));
}

function adaptV2Section(section) {
  if (!section) {
    return section;
  }
  const totalBeds = numberFrom(section.active_bed_count);
  const occupiedBeds = numberFrom(section.occupied_bed_count);
  const reservedBeds = numberFrom(section.reserved_bed_count);
  const cleaningBeds = numberFrom(section.cleaning_bed_count);
  const maintenanceBeds = section.blocked_bed_count
    ?? section.maintenance_bed_count
    ?? section.closed_bed_count;
  const fallbackAvailableBeds = Math.max(totalBeds - occupiedBeds - reservedBeds - cleaningBeds, 0);
  const availableBeds = section.available_bed_count === undefined || section.available_bed_count === null
    ? fallbackAvailableBeds
    : numberFrom(section.available_bed_count);

  return {
    ...section,
    ward: section.ward_id,
    bed_count: totalBeds,
    available_beds_count: availableBeds,
    occupied_beds_count: occupiedBeds,
    reserved_beds_count: reservedBeds,
    cleaning_beds_count: cleaningBeds,
    maintenance_beds_count: maintenanceBeds === undefined || maintenanceBeds === null
      ? undefined
      : numberFrom(maintenanceBeds),
    is_active: section.status === 'active',
    description: section.description || '',
  };
}

function adaptBedMapTotals(totals = {}) {
  return {
    total_beds: numberFrom(totals.total_bed_count),
    available_beds_count: numberFrom(totals.available_bed_count),
    occupied_beds_count: numberFrom(totals.occupied_bed_count),
    reserved_beds_count: numberFrom(totals.reserved_bed_count),
    cleaning_beds_count: numberFrom(totals.cleaning_bed_count),
    maintenance_beds_count: numberFrom(totals.blocked_bed_count),
  };
}

function adaptBedMapSection(section = {}, wardId) {
  const { beds: _beds, totals: _totals, ...sectionDetails } = section;
  const totals = adaptBedMapTotals(section.totals);
  return {
    ...sectionDetails,
    id: section.id || 'unassigned',
    ward: wardId,
    ward_id: wardId,
    code: section.code || null,
    name: section.name || 'Unassigned Beds',
    is_active: section.status ? section.status === 'active' : true,
    bed_count: totals.total_beds,
    available_beds_count: totals.available_beds_count,
    occupied_beds_count: totals.occupied_beds_count,
    reserved_beds_count: totals.reserved_beds_count,
    cleaning_beds_count: totals.cleaning_beds_count,
    maintenance_beds_count: totals.maintenance_beds_count,
  };
}

function adaptBedMapBed(bed = {}, wardId, sectionId) {
  return adaptV2Bed({
    ...bed,
    ward_id: bed.ward_id || wardId,
    section_id: bed.section_id || sectionId || null,
  });
}

function buildBedMapFromParts({ wardId, sections = [], beds = [], totals }) {
  const bedTotals = totals || beds.reduce(
    (acc, bed) => {
      acc.total_bed_count += 1;
      const status = bed.status === 'closed' || bed.status === 'maintenance' || bed.status === 'blocked'
        ? 'blocked'
        : bed.status;
      if (status === 'available') acc.available_bed_count += 1;
      if (status === 'occupied') acc.occupied_bed_count += 1;
      if (status === 'reserved') acc.reserved_bed_count += 1;
      if (status === 'cleaning') acc.cleaning_bed_count += 1;
      if (status === 'blocked') acc.blocked_bed_count += 1;
      return acc;
    },
    {
      total_bed_count: 0,
      available_bed_count: 0,
      occupied_bed_count: 0,
      reserved_bed_count: 0,
      cleaning_bed_count: 0,
      blocked_bed_count: 0,
    },
  );

  return {
    ward_id: wardId,
    totals: adaptBedMapTotals(bedTotals),
    sections,
    beds,
  };
}

function adaptV2BedMap(data = {}) {
  const wardId = data.ward_id;
  const sections = [];
  const beds = [];

  (data.sections || []).forEach((section) => {
    const sectionModel = adaptBedMapSection(section, wardId);
    sections.push(sectionModel);
    (section.beds || []).forEach((bed) => {
      beds.push(adaptBedMapBed(bed, wardId, section.id));
    });
  });

  return buildBedMapFromParts({
    wardId,
    sections,
    beds,
    totals: data.totals,
  });
}

function buildLegacyBedMap(wardId, rawBeds = [], rawSections = []) {
  const sections = normalizeListResponse(rawSections).map((section) => adaptV2Section(section));
  const beds = normalizeListResponse(rawBeds).map((bed) => adaptV2Bed(bed));
  return buildBedMapFromParts({ wardId, sections, beds });
}

function wardIdFrom(data = {}) {
  return data.ward_id || data.ward;
}

function sectionIdFrom(data = {}) {
  return data.section_id || data.section || null;
}

function bedCodeFrom(data = {}) {
  return data.bed_code || data.bed_number || data.name || '';
}

function bedUpdatePayloadFrom(data = {}) {
  const payload = {};
  const sectionId = data.section_id ?? data.section;
  if (sectionId !== undefined && sectionId !== null) {
    payload.section_id = sectionId;
  }
  const bedCode = data.bed_code ?? data.bed_number ?? data.name;
  if (bedCode !== undefined && bedCode !== null) {
    payload.bed_code = String(bedCode).trim();
  }
  if (data.status) {
    payload.status = data.status;
  }
  return payload;
}

function wardPayloadFrom(data = {}) {
  const name = String(data.name || data.label || data.code || '').trim();
  const explicitCode = data.code ?? data.ward_code;
  const code = explicitCode !== undefined && explicitCode !== null
    ? String(explicitCode).trim()
    : deriveRustCodeFromName(name || data.ward_type, 'WARD');
  return { code, name };
}

function hasOwn(data, key) {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function wardUpdatePayloadFrom(data = {}) {
  const payload = {};
  const code = data.code ?? data.ward_code ?? data.ward_type;
  if (code !== undefined && code !== null) {
    payload.code = String(code).trim();
  }
  const name = data.name ?? data.label;
  if (name !== undefined && name !== null) {
    payload.name = String(name).trim();
  }
  if (data.status) {
    payload.status = data.status;
  } else if (hasOwn(data, 'is_active')) {
    payload.status = data.is_active ? 'active' : 'inactive';
  }
  return payload;
}

function admissionPayloadFrom(data = {}) {
  return {
    patient_id: data.patient_id || data.patient,
    ward_id: data.ward_id || data.ward,
    bed_id: data.bed_id || data.bed || null,
  };
}

/**
 * Wards API service
 */
export const wardsApi = {
  /**
   * Get wards API root information
   * @returns {Promise<Object>} API root information with links to resources
   */
  getWardsRoot: async (options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return {
          mode: 'rust-v2',
          resources: ['wards', 'beds', 'sections', 'admissions'],
        };
      }
      return await apiClient.get('/wards/', options);
    } catch (error) {
      rethrowAbortError(error);
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
            search: params.search ? String(params.search).trim() : undefined,
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
        const response = await v2Api.getWards({
          query: {
            limit: normalizeV2Limit(filters, 50),
            search: String(query).trim(),
          },
          signal: filters.signal,
        });
        return v2ListData(response).map(adaptV2Ward);
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
  getWard: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardById({ id }, { signal: options.signal });
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
  createWard: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postWard(wardPayloadFrom(data), {
          signal: options.signal || data?.signal,
        });
        return adaptV2Ward(response?.data || {});
      }
      return await apiClient.post('/wards/wards/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create ward');
      }
      throw new Error(handleApiError(error, 'Failed to create ward'));
    }
  },

  /**
   * Update a ward (admin only)
   * @param {string} id - Ward ID
   * @param {Object} data - Ward data to update
   * @returns {Promise<Object>} Updated ward data
   */
  updateWard: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchWard({ id }, wardUpdatePayloadFrom(data), {
          signal: options.signal || data?.signal,
        });
        return adaptV2Ward(response?.data || {});
      }
      return await apiClient.patch(`/wards/wards/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update ward');
      }
      throw new Error(handleApiError(error, 'Failed to update ward'));
    }
  },

  /**
   * Delete a ward (admin only)
   * @param {string} id - Ward ID
   * @returns {Promise<void>}
   */
  deleteWard: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchWard({ id }, { status: 'inactive' }, {
          signal: options.signal,
        });
        return adaptV2Ward(response?.data || {});
      }
      return await apiClient.delete(`/wards/wards/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to delete ward');
      }
      throw new Error(handleApiError(error, 'Failed to delete ward'));
    }
  },

  /**
   * Get the complete operational bed map for a ward.
   * @param {string} wardId - Ward ID
   * @returns {Promise<Object>} Ward bed map data
   */
  getBedMap: async (wardId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardBedMap({ id: wardId }, { signal: options.signal });
        return adaptV2BedMap(response?.data || {});
      }

      const [beds, sections] = await Promise.all([
        wardsApi.getBeds({ ward: wardId, signal: options.signal }),
        wardsApi.getWardSections(wardId, { signal: options.signal }),
      ]);
      return buildLegacyBedMap(wardId, beds, sections);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch ward bed map');
      }
      throw new Error(handleApiError(error, 'Failed to fetch ward bed map'));
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
              cursor: params.cursor ?? params.next_cursor,
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
        const { ward: _ward, ...restParams } = params;

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
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch beds');
      }
      throw new Error(handleApiError(error, 'Failed to fetch beds'));
    }
  },

  /**
   * Get a single bed by ID
   * @param {string} id - Bed ID
   * @returns {Promise<Object>} Bed data
   */
  getBed: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardBedById({ id }, { signal: options.signal });
        return adaptV2Bed(response?.data);
      }
      return await apiClient.get(`/wards/beds/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch bed');
      }
      throw new Error(handleApiError(error, 'Failed to fetch bed'));
    }
  },

  /**
   * Create a new bed (admin only)
   * @param {Object} data - Bed data
   * @returns {Promise<Object>} Created bed data
   */
  createBed: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const wardId = wardIdFrom(data);
        const bedCode = bedCodeFrom(data).trim();
        if (!wardId || !bedCode) {
          throw new Error('Rust V2 bed creation requires a ward and bed code.');
        }
        const response = await v2Api.postWardBed(
          { id: wardId },
          {
            section_id: sectionIdFrom(data),
            bed_code: bedCode,
          },
          { signal: options.signal },
        );
        return adaptV2Bed(response?.data);
      }
      return await apiClient.post('/wards/beds/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create bed');
      }
      throw new Error(handleApiError(error, 'Failed to create bed'));
    }
  },

  /**
   * Update a bed (admin only)
   * @param {string} id - Bed ID
   * @param {Object} data - Bed data to update
   * @returns {Promise<Object>} Updated bed data
   */
  updateBed: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchWardBed({ id }, bedUpdatePayloadFrom(data), {
          signal: options.signal || data?.signal,
        });
        return adaptV2Bed(response?.data);
      }
      return await apiClient.patch(`/wards/beds/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update bed');
      }
      throw new Error(handleApiError(error, 'Failed to update bed'));
    }
  },

  /**
   * Delete a bed (admin only)
   * @param {string} id - Bed ID
   * @returns {Promise<void>}
   */
  deleteBed: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchWardBed({ id }, { status: 'closed' }, {
          signal: options.signal,
        });
        return adaptV2Bed(response?.data);
      }
      return await apiClient.delete(`/wards/beds/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to delete bed');
      }
      throw new Error(handleApiError(error, 'Failed to delete bed'));
    }
  },

  /**
   * Get all admissions with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of admissions
   */
  getAdmissions: async (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        if (shouldUseWardBoardAdmissions(params)) {
          const response = await v2Api.getWardBoard({
            query: {
              limit: normalizeV2Limit(params),
              cursor: params.cursor ?? params.next_cursor,
              ward_id: params.ward_id ?? params.ward,
            },
            signal: options.signal,
          });
          return v2ListData(response).map(adaptV2WardBoardAdmission);
        }

        const response = await v2Api.getAdmissionCases({
          query: {
            limit: normalizeV2Limit(params),
            cursor: params.cursor ?? params.next_cursor,
          },
          signal: options.signal,
        });
        return v2ListData(response).map(adaptV2WardBoardAdmission);
      } catch (error) {
        rethrowV2Error(error, 'Failed to fetch admissions');
      }
    }

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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getAdmissionById({ id });
        return adaptV2WardBoardAdmission(response?.data);
      }
      return await apiClient.get(`/wards/admissions/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch admission');
      }
      throw new Error(handleApiError(error, 'Failed to fetch admission'));
    }
  },

  /**
   * Create a new admission
   * @param {Object} data - Admission data
   * @returns {Promise<Object>} Created admission data
   */
  createAdmission: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const payload = admissionPayloadFrom(data);
        if (!payload.patient_id || !payload.ward_id) {
          throw new Error('Rust V2 admission creation requires a patient and ward.');
        }
        const response = await v2Api.postAdmissions(payload, { signal: options.signal });
        return adaptV2WardBoardAdmission(response?.data);
      }
      return await apiClient.post('/wards/admissions/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create admission');
      }
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
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('admission updates');
      }
      return await apiClient.patch(`/wards/admissions/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update admission');
      }
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
      if (isRustV2ApiMode()) {
        return [];
      }
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
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('ward transfers');
      }
      return await apiClient.post('/wards/transfers/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create transfer');
      }
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
      if (isRustV2ApiMode()) {
        return [];
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardAnalytics({
          query: {
            ward_id: params.ward_id && params.ward_id !== 'all' ? params.ward_id : undefined,
            start_date: params.start_date,
            end_date: params.end_date,
          },
          signal: params.signal,
        });
        return adaptV2WardAnalytics(response);
      }
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
      if (isRustV2ApiMode()) {
        const wardId = wardIdFrom(params);
        if (!wardId) {
          return [];
        }
        const response = await v2Api.getWardSections(
          { id: wardId },
          {
            query: {
              cursor: params.cursor,
              limit: normalizeV2Limit(params),
            },
            signal: params.signal,
          },
        );
        return v2ListData(response).map(adaptV2Section);
      }
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/wards/sections/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch ward sections');
      }
      throw new Error(handleApiError(error, 'Failed to fetch ward sections'));
    }
  },

  /**
   * Get sections for a specific ward
   * @param {string} wardId - Ward ID
   * @returns {Promise<Array>} List of sections for the ward
   */
  getWardSections: async (wardId, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardSections(
          { id: wardId },
          {
            query: {
              limit: normalizeV2Limit(options, 25),
              ...(options.cursor ? { cursor: options.cursor } : {}),
            },
            signal: options.signal,
          },
        );
        return v2ListData(response).map(adaptV2Section);
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
  getSection: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardSectionById({ id }, { signal: options.signal });
        return adaptV2Section(response?.data);
      }
      return await apiClient.get(`/wards/sections/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch section');
      }
      throw new Error(handleApiError(error, 'Failed to fetch section'));
    }
  },

  /**
   * Create a new ward section (admin only)
   * @param {Object} data - Section data
   * @returns {Promise<Object>} Created section data
   */
  createSection: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const wardId = wardIdFrom(data);
        const name = String(data.name || '').trim();
        const explicitCode = data.code ?? data.section_code;
        const code = explicitCode !== undefined && explicitCode !== null
          ? String(explicitCode).trim()
          : deriveRustCodeFromName(name, 'SECTION');
        if (!wardId || !code || !name) {
          throw new Error('Rust V2 section creation requires a ward, code, and name.');
        }
        const response = await v2Api.postWardSection(
          { id: wardId },
          { code, name },
          { signal: options.signal },
        );
        return adaptV2Section(response?.data);
      }
      return await apiClient.post('/wards/sections/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create section');
      }
      throw new Error(handleApiError(error, 'Failed to create section'));
    }
  },

  /**
   * Update a ward section (admin only)
   * @param {string} id - Section ID
   * @param {Object} data - Section data to update
   * @returns {Promise<Object>} Updated section data
   */
  updateSection: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchWardSection({ id }, wardUpdatePayloadFrom(data), {
          signal: options.signal || data?.signal,
        });
        return adaptV2Section(response?.data);
      }
      return await apiClient.patch(`/wards/sections/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update section');
      }
      throw new Error(handleApiError(error, 'Failed to update section'));
    }
  },

  /**
   * Delete a ward section (admin only)
   * @param {string} id - Section ID
   * @returns {Promise<void>}
   */
  deleteSection: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchWardSection({ id }, { status: 'inactive' }, {
          signal: options.signal,
        });
        return adaptV2Section(response?.data);
      }
      return await apiClient.delete(`/wards/sections/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to delete section');
      }
      throw new Error(handleApiError(error, 'Failed to delete section'));
    }
  },

  /**
   * Get beds in a specific section
   * @param {string} sectionId - Section ID
   * @returns {Promise<Array>} List of beds in the section
   */
  getSectionBeds: async (sectionId, params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardSectionBeds(
          { id: sectionId },
          {
            query: {
              cursor: params.cursor,
              limit: normalizeV2Limit(params, 25),
            },
            signal: options.signal,
          },
        );
        return v2ListData(response).map(adaptV2Bed);
      }
      return await apiClient.get(`/wards/sections/${sectionId}/beds/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch section beds');
      }
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
      if (isRustV2ApiMode()) {
        return [];
      }
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
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('amenity detail');
      }
      return await apiClient.get(`/wards/amenities/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch amenity');
      }
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
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('amenity mutations');
      }
      return await apiClient.post('/wards/amenities/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create amenity');
      }
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
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('amenity mutations');
      }
      return await apiClient.patch(`/wards/amenities/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update amenity');
      }
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
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('amenity mutations');
      }
      return await apiClient.delete(`/wards/amenities/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to delete amenity');
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardStaff({ id: wardId }, {
          query: {
            ...(params.category ? { category: params.category } : {}),
          },
        });
        return normalizeListResponse(response);
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardStaffAssignments({
          query: v2AssignmentQuery(params),
        });
        return normalizeListResponse(response).map(adaptV2StaffAssignment);
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardStaffAssignmentsByPractitioner({
          query: { practitioner_id: practitionerId },
        });
        return normalizeListResponse(response).map(adaptV2StaffAssignment);
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardStaffAssignmentById({ id });
        return adaptV2StaffAssignment(normalizeObjectResponse(response));
      }
      return await apiClient.get(`/wards/staff-assignments/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch staff assignment');
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.postWardStaffAssignment(data);
        return adaptV2StaffAssignment(normalizeObjectResponse(response));
      }
      return await apiClient.post('/wards/staff-assignments/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to create staff assignment');
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchWardStaffAssignment({ id }, data);
        return adaptV2StaffAssignment(normalizeObjectResponse(response));
      }
      return await apiClient.patch(`/wards/staff-assignments/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to update staff assignment');
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.deleteWardStaffAssignment({ id });
        return adaptV2StaffAssignment(normalizeObjectResponse(response));
      }
      return await apiClient.delete(`/wards/staff-assignments/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to delete staff assignment');
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getWardStaffRoles({
          query: {
            ...(params.category ? { category: params.category } : {}),
            ...(params.show_inactive !== undefined ? { show_inactive: params.show_inactive } : {}),
          },
        });
        return normalizeListResponse(response);
      }
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
      if (isRustV2ApiMode()) {
        return await rustV2Unsupported('staff role detail');
      }
      return await apiClient.get(`/wards/staff-roles/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        rethrowV2Error(error, 'Failed to fetch staff role');
      }
      throw new Error(handleApiError(error, 'Failed to fetch staff role'));
    }
  },
};
