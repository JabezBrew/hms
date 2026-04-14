export const BODY_MAP_SURFACES = ['front', 'back'];
export const BODY_MAP_SIDES = ['left', 'center', 'right'];

export const BODY_MAP_REGIONS = [
  { value: 'head', label: 'Head' },
  { value: 'neck', label: 'Neck' },
  { value: 'shoulder', label: 'Shoulder' },
  { value: 'chest', label: 'Chest' },
  { value: 'abdomen', label: 'Abdomen' },
  { value: 'pelvis', label: 'Pelvis' },
  { value: 'upper_arm', label: 'Upper Arm' },
  { value: 'forearm', label: 'Forearm' },
  { value: 'hand', label: 'Hand' },
  { value: 'upper_back', label: 'Upper Back' },
  { value: 'lower_back', label: 'Lower Back' },
  { value: 'hip', label: 'Hip' },
  { value: 'thigh', label: 'Thigh' },
  { value: 'knee', label: 'Knee' },
  { value: 'calf', label: 'Calf' },
  { value: 'foot', label: 'Foot' },
];

export function getBodyMapRegionLabel(region) {
  return BODY_MAP_REGIONS.find((item) => item.value === region)?.label || region || 'Unknown region';
}

export function formatBodyMapValue(value) {
  if (!value || typeof value !== 'object') {
    return '—';
  }

  const parts = [];
  if (value.surface) parts.push(value.surface);
  if (value.side) parts.push(value.side);
  if (value.region) parts.push(getBodyMapRegionLabel(value.region));
  if (value.markerLabel) parts.push(value.markerLabel);
  return parts.length ? parts.join(' • ') : '—';
}
