export const ADMISSION_STATUS_OPTIONS = [
  { value: 'all', label: 'Any status' },
  { value: 'ready_for_activation', label: 'Ready for activation' },
  { value: 'admitted', label: 'Admitted' },
  { value: 'discharge_pending', label: 'Discharge pending' },
  { value: 'discharged', label: 'Discharged' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const RECORD_STATUS_OPTIONS = [
  { value: 'all', label: 'Any record status' },
  { value: 'registered', label: 'Registered record' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'entered_in_error', label: 'Entered in error' },
  { value: 'superseded', label: 'Merged record' },
];

export const VITAL_STATUS_OPTIONS = [
  { value: 'all', label: 'Any vital status' },
  { value: 'presumed_alive', label: 'Presumed alive' },
  { value: 'deceased', label: 'Deceased' },
  { value: 'unknown', label: 'Unknown' },
];

export const DEFAULT_SEARCH_ORDERING = '-created_at';
export const SEARCH_TABLE_PAGE_SIZE = 25;
export const DEFAULT_RECORD_STATUS_FILTER = 'all';
export const DEFAULT_VITAL_STATUS_FILTER = 'all';
export const RECENT_REGISTRATION_STATUS = 'registered';

export const DIRECTORY_SECTION_LABELS = {
  recent: 'Recent registrations',
  search: 'Search results',
  filtered: 'Filtered patient records',
};

export const TABLE_COLUMNS = [
  { key: 'created_at', label: 'Registered' },
  { key: 'medical_record_number', label: 'MRN' },
  { key: 'name', label: 'Name' },
  { key: 'date_of_birth', label: 'DOB / Age' },
  { key: 'gender', label: 'Sex' },
  { key: 'patient_location', label: 'Current Care Location', sortable: false },
  { key: 'registry_status', label: 'Record Status' },
];
