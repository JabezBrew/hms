/**
 * Constants for Duty Roster Management
 */

// Sentinel values for Select components (Radix doesn't allow empty strings)
export const SELECT_ALL = '__all__';
export const SELECT_NONE = '__none__';
export const SELECT_DEFAULT = '__default__';

export const DUTY_CONTEXT_OPTIONS = [
  { value: 'inpatient', label: 'Inpatient' },
  { value: 'outpatient', label: 'Outpatient' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'all', label: 'All Contexts' },
];

export const DUTY_ROLE_OPTIONS = [
  { value: 'admitting', label: 'Admitting' },
  { value: 'covering', label: 'Covering' },
  { value: 'consulting', label: 'Consulting' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'on_call', label: 'On Call' },
];

export const DUTY_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export const STATUS_BADGE_CLASSES = {
  draft: 'bg-muted text-muted-foreground border-border',
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  archived: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
};

export const DEFAULT_CYCLE_LENGTH = 7;

export const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const CSV_DELIMITER_HELP = "Use commas with a header row. Dates use YYYY-MM-DD. Times use HH:MM. pattern_name is optional.";
