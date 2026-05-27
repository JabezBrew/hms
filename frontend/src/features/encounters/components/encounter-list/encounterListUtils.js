import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import isValid from 'date-fns/isValid';

import { ENCOUNTER_PAGE_SIZE } from './encounterListConstants';

export function buildEncounterQueryParams({ activeTab, currentPage, filters }) {
  const queryParams = {
    page: currentPage,
    page_size: ENCOUNTER_PAGE_SIZE,
  };

  if (activeTab === 'inpatient') {
    queryParams.encounter_type = 'inpatient';
  } else if (activeTab === 'outpatient') {
    queryParams.encounter_type = 'outpatient';
  } else if (activeTab === 'emergency') {
    queryParams.encounter_type = 'emergency';
  }

  if (filters.patient) {
    queryParams.patient_id = filters.patient;
  }

  if (filters.practitioner) {
    queryParams.practitioner_id = filters.practitioner;
  }

  if (filters.date) {
    queryParams.date = format(filters.date, 'yyyy-MM-dd');
  }

  if (filters.status && filters.status !== 'all') {
    queryParams.status = filters.status;
  }

  if (filters.type && filters.type !== 'all' && activeTab === 'all') {
    queryParams.encounter_type = filters.type;
  }

  return queryParams;
}

export function hasActiveEncounterFilters(filters, activeTab) {
  return Boolean(
    filters.patient
    || filters.practitioner
    || filters.date
    || filters.status !== 'all'
    || (filters.type !== 'all' && activeTab === 'all')
  );
}

export function formatEncounterDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = parseISO(dateString);
    return isValid(date) ? format(date, 'MMM d, yyyy h:mm a') : 'Invalid date';
  } catch {
    return 'Invalid date';
  }
}

export function getEncounterStatusConfig(status) {
  switch (status) {
    case 'planned':
      return { className: 'border-sky-200 bg-sky-50 text-sky-700', label: 'Planned' };
    case 'in-progress':
      return { className: 'border-amber-200 bg-amber-50 text-amber-700', label: 'In Progress' };
    case 'finished':
      return { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', label: 'Finished' };
    case 'cancelled':
      return { className: 'border-rose-200 bg-rose-50 text-rose-700', label: 'Cancelled' };
    default:
      return { className: 'border-border bg-muted text-muted-foreground', label: status || 'Unknown' };
  }
}

export function getEncounterTypeConfig(type) {
  switch (type) {
    case 'inpatient':
      return { label: 'Inpatient' };
    case 'outpatient':
      return { label: 'Outpatient' };
    case 'emergency':
      return { label: 'Emergency' };
    default:
      return { label: type || 'Encounter' };
  }
}

export function getEncounterPageNumbers({ currentPage, totalPages }) {
  return Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
    if (totalPages <= 5) {
      return index + 1;
    }
    if (currentPage <= 3) {
      return index + 1;
    }
    if (currentPage >= totalPages - 2) {
      return totalPages - 4 + index;
    }
    return currentPage - 2 + index;
  });
}
