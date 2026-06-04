import { format } from 'date-fns';

import {
  SEARCH_TABLE_PAGE_SIZE,
} from './registryConstants';

export const NO_CURRENT_ADMISSION_LOCATION_LABEL = 'Not admitted';

export const createEmptyFilters = () => ({
  admissionStart: null,
  admissionEnd: null,
  wardId: '',
  admissionStatus: 'all',
  attending: null,
  ageMin: '',
  ageMax: '',
});

export const countActiveFilters = (filters) => {
  let count = 0;
  if (filters.admissionStart || filters.admissionEnd) count += 1;
  if (filters.wardId) count += 1;
  if (filters.admissionStatus && filters.admissionStatus !== 'all') count += 1;
  if (filters.attending?.id) count += 1;
  if (filters.ageMin || filters.ageMax) count += 1;
  return count;
};

export const buildSearchParams = (query, filters, registryScope) => {
  const params = {};
  if (query && query.trim().length >= 2) {
    params.query = query.trim();
  }
  params.registry_scope = registryScope;

  if (filters.admissionStart) {
    params.admission_start = format(filters.admissionStart, 'yyyy-MM-dd');
  }
  if (filters.admissionEnd) {
    params.admission_end = format(filters.admissionEnd, 'yyyy-MM-dd');
  }
  if (filters.wardId) {
    params.ward = filters.wardId;
  }
  if (filters.admissionStatus && filters.admissionStatus !== 'all') {
    params.admission_status = filters.admissionStatus;
  }
  if (filters.attending?.id) {
    params.attending_id = filters.attending.id;
  }
  if (filters.ageMin) {
    params.age_min = filters.ageMin;
  }
  if (filters.ageMax) {
    params.age_max = filters.ageMax;
  }

  return params;
};

export const getPatientId = (patient) => {
  return patient?.id || patient?.patient_profile || patient?.local_data?.id || null;
};

export const getPatientAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
};

export const formatGender = (gender) => {
  if (!gender) return '-';
  const code = String(gender).toLowerCase();
  if (code === 'm' || code === 'male') return 'Male';
  if (code === 'f' || code === 'female') return 'Female';
  if (code === 'o' || code === 'other') return 'Other';
  return String(gender);
};

export const formatDateLabel = (value, template = 'MMM d, yyyy') => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return format(date, template);
};

export const formatAdmissionStatus = (status) => {
  if (!status) return '-';
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getAdmissionLocationLabel = (patient) => {
  const admission = patient?.active_admission || patient?.active_context?.admission || patient?.admission || null;
  const wardName = patient?.ward_name || patient?.current_ward || admission?.ward_name || admission?.ward || '';
  const bedCode = patient?.bed_code || patient?.bed_number || patient?.current_bed || admission?.bed_code || admission?.bed_number || '';

  if (wardName && bedCode) {
    return `${wardName} / Bed ${bedCode}`;
  }
  if (wardName) {
    return wardName;
  }
  if (bedCode) {
    return `Bed ${bedCode}`;
  }
  return '';
};

export const getPatientLocationDisplay = (patient) => {
  const activeClinicNames = Array.isArray(patient?.active_clinic_names)
    ? patient.active_clinic_names.filter(Boolean)
    : [];

  if (activeClinicNames.length > 1) {
    return {
      label: `${activeClinicNames[0]} +${activeClinicNames.length - 1}`,
      tooltip: activeClinicNames.join(', '),
    };
  }

  if (activeClinicNames.length === 1) {
    return {
      label: activeClinicNames[0],
      tooltip: null,
    };
  }

  return {
    label: patient?.patient_location || getAdmissionLocationLabel(patient) || NO_CURRENT_ADMISSION_LOCATION_LABEL,
    tooltip: null,
  };
};

const getKnownResultCount = ({ currentPage, pageSize, visibleCount }) => {
  if (visibleCount <= 0) {
    return 0;
  }
  return ((currentPage - 1) * pageSize) + visibleCount;
};

const formatResultCountLabel = ({ count, isExact, hasNextPage }) => {
  if (isExact || !hasNextPage) {
    return String(count);
  }
  return null;
};

export function buildSearchResultMeta({
  searchResults,
  searchPage,
  searchPatients,
  hasSearchSignal,
  effectiveSearchQuery,
}) {
  const currentPage = searchResults?.page ?? searchPage;
  const pageSize = searchResults?.page_size ?? SEARCH_TABLE_PAGE_SIZE;
  const countExact = searchResults?.count_exact !== false;
  const hasNext = Boolean(searchResults?.next);
  const hasPrevious = Boolean(searchResults?.previous) || currentPage > 1;
  const knownResultCount = getKnownResultCount({
    currentPage,
    pageSize,
    visibleCount: searchPatients.length,
  });
  const total = countExact
    ? (searchResults?.total ?? searchResults?.count ?? searchPatients.length)
    : knownResultCount;
  const totalPages = countExact
    ? (pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1)
    : currentPage;

  return {
    currentPage,
    total,
    totalLabel: formatResultCountLabel({
      count: total,
      isExact: countExact,
      hasNextPage: hasNext,
    }),
    pagination: {
      currentPage,
      pageSize,
      totalPages,
      totalResults: total,
      totalResultsExact: countExact,
      hasNextPage: hasNext,
      hasPreviousPage: hasPrevious,
    },
    summary: formatSearchSummary({
      hasSearchSignal,
      effectiveSearchQuery,
      countExact,
      total,
      visibleCount: searchPatients.length,
    }),
  };
}

function formatSearchSummary({
  hasSearchSignal,
  effectiveSearchQuery,
  countExact,
  total,
  visibleCount,
}) {
  if (!hasSearchSignal) {
    return '';
  }
  if (effectiveSearchQuery) {
    return countExact
      ? `${total} result${total === 1 ? '' : 's'} for "${effectiveSearchQuery}"`
      : `Showing ${visibleCount} result${visibleCount === 1 ? '' : 's'} for "${effectiveSearchQuery}"`;
  }
  return countExact
    ? `${total} filtered result${total === 1 ? '' : 's'}`
    : `Showing ${visibleCount} filtered result${visibleCount === 1 ? '' : 's'}`;
}

export const deduplicatePatients = (patients) => {
  return patients.reduce((acc, patientData) => {
    const patient = patientData?.local_data || patientData;
    const id = patient?.id;
    if (id && !acc.seen.has(id)) {
      acc.seen.add(id);
      acc.list.push(patient);
    } else if (!id) {
      acc.list.push(patient);
    }
    return acc;
  }, { seen: new Set(), list: [] }).list;
};

export const getPatientRowKey = (patient) => {
  const patientId = getPatientId(patient);
  if (patientId) {
    return `table-${patientId}`;
  }

  const fallbackKey = [
    patient?.medical_record_number,
    patient?.nhis_number,
    patient?.name,
    patient?.date_of_birth,
    patient?.created_at,
  ].filter(Boolean).join('-');

  return fallbackKey ? `table-${fallbackKey}` : 'table-unidentified-patient';
};
