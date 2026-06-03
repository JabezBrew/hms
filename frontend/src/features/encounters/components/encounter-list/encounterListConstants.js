export const ENCOUNTER_PAGE_SIZE = 20;

export const ENCOUNTER_TABS = [
  { value: 'all', label: 'All Encounters' },
  { value: 'inpatient', label: 'Inpatient' },
  { value: 'outpatient', label: 'Outpatient' },
  { value: 'emergency', label: 'Emergency' },
];

export const RUST_V2_ENCOUNTER_TABS = [
  { value: 'all', label: 'All Encounters' },
  { value: 'outpatient', label: 'Outpatient' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'triage', label: 'Triage' },
];

export const ENCOUNTER_STATUS_OPTIONS = [
  ['all', 'All statuses'],
  ['planned', 'Planned'],
  ['in-progress', 'In Progress'],
  ['finished', 'Finished'],
  ['cancelled', 'Cancelled'],
];

export const RUST_V2_ENCOUNTER_STATUS_OPTIONS = [
  ['all', 'All statuses'],
  ['in-progress', 'In Progress'],
  ['finished', 'Finished'],
  ['cancelled', 'Cancelled'],
];

export const ENCOUNTER_TYPE_OPTIONS = [
  ['all', 'All types'],
  ['inpatient', 'Inpatient'],
  ['outpatient', 'Outpatient'],
  ['emergency', 'Emergency'],
];

export const RUST_V2_ENCOUNTER_TYPE_OPTIONS = [
  ['all', 'All types'],
  ['outpatient', 'Outpatient'],
  ['emergency', 'Emergency'],
  ['triage', 'Triage'],
];

export const INITIAL_ENCOUNTER_FILTERS = {
  patient: '',
  practitioner: '',
  date: null,
  status: 'all',
  type: 'all',
};
