import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Bandage from 'lucide-react/dist/esm/icons/bandage.js';
import Beaker from 'lucide-react/dist/esm/icons/beaker.js';
import Brain from 'lucide-react/dist/esm/icons/brain.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Heart from 'lucide-react/dist/esm/icons/heart.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Wind from 'lucide-react/dist/esm/icons/wind.js';

export const CATEGORY_ICONS = {
  neurological: Brain,
  cardiovascular: Heart,
  respiratory: Wind,
  metabolic: Beaker,
  pain: Activity,
  wound: Bandage,
  custom: MoreHorizontal,
};

export const SCOPE_OPTIONS = [
  { value: 'encounter', label: 'Encounter', description: 'Scoped to a single clinical visit' },
  { value: 'admission', label: 'Admission', description: 'Scoped to an inpatient admission' },
  { value: 'patient', label: 'Patient', description: 'Longitudinal across all visits' },
];

export const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private', description: 'Only you can see' },
  { value: 'role', label: 'Role', description: 'Same role can see' },
  { value: 'department', label: 'Department', description: 'Department can see' },
  { value: 'facility', label: 'Facility', description: 'Everyone can see' },
];

export const DISPLAY_MODES = [
  { value: 'table', label: 'Table', description: 'Traditional grid layout' },
  { value: 'grid', label: 'Grid', description: 'Card-based layout' },
  { value: 'timeline', label: 'Timeline', description: 'Chronological view' },
];

export const STEPS = [
  { id: 1, name: 'Basic Info', icon: Info },
  { id: 2, name: 'Fields', icon: ListOrdered },
  { id: 3, name: 'Settings', icon: Settings },
  { id: 4, name: 'Preview', icon: Eye },
];

export const getInitialFormData = (existingTemplate) => ({
  name: existingTemplate?.name || '',
  description: existingTemplate?.description || '',
  category: existingTemplate?.category || 'custom',
  scope_type: existingTemplate?.scope_type || 'patient',
  visibility: existingTemplate?.visibility || 'private',
  default_interval: existingTemplate?.default_interval || 'hourly',
  display_mode: existingTemplate?.display_mode || 'table',
  is_active: existingTemplate?.is_active ?? true,
});

export const getInitialFields = (existingTemplate) => (
  Array.isArray(existingTemplate?.fields) ? existingTemplate.fields : []
);

export const buildPreviewData = (fields) => {
  const data = {};
  fields.forEach((field) => {
    if (field.field_type === 'numeric') {
      data[field.field_key] = field.config?.default ?? 0;
    } else if (field.field_type === 'boolean') {
      data[field.field_key] = false;
    } else if (field.field_type === 'select') {
      data[field.field_key] = field.config?.options?.[0]?.value ?? '';
    } else if (field.field_type === 'scale') {
      const min = field.config?.min ?? 0;
      const max = field.config?.max ?? 10;
      data[field.field_key] = Math.floor((min + max) / 2);
    } else {
      data[field.field_key] = null;
    }
  });
  return data;
};
