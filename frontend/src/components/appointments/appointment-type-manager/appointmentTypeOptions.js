export const COLOR_OPTIONS = [
  { name: 'Blue', value: '#1976D2' },
  { name: 'Red', value: '#D32F2F' },
  { name: 'Green', value: '#388E3C' },
  { name: 'Purple', value: '#7B1FA2' },
  { name: 'Orange', value: '#F57C00' },
  { name: 'Teal', value: '#00796B' },
  { name: 'Pink', value: '#C2185B' },
  { name: 'Indigo', value: '#303F9F' },
  { name: 'Amber', value: '#FFA000' },
  { name: 'Cyan', value: '#0097A7' },
];

export const CATEGORY_OPTIONS = [
  { name: 'In Person', value: 'in_person' },
  { name: 'Virtual', value: 'virtual' },
  { name: 'Home Visit', value: 'home_visit' },
  { name: 'Procedure', value: 'procedure' },
];

export const APPOINTMENT_TYPE_DEFAULTS = {
  id: '',
  name: '',
  duration_minutes: 30,
  description: '',
  color: '#1976D2',
  is_active: true,
  category: 'in_person',
};
