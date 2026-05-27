export const ENCOUNTER_PAGE_SIZE = 20;

export const ENCOUNTER_TABS = [
  { value: 'all', label: 'All Encounters' },
  { value: 'inpatient', label: 'Inpatient' },
  { value: 'outpatient', label: 'Outpatient' },
  { value: 'emergency', label: 'Emergency' },
];

export const INITIAL_ENCOUNTER_FILTERS = {
  patient: '',
  practitioner: '',
  date: null,
  status: 'all',
  type: 'all',
};
