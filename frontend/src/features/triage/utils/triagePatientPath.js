function resourceId(value) {
  return value && typeof value === 'object' ? value.id || value.uuid : value;
}

export function triagePatientPath(entry) {
  const patientId = resourceId(entry.patient_id || entry.patient);
  if (!patientId) return '/patients';
  const encounterId = resourceId(entry.encounter_id || entry.encounter);
  const params = new URLSearchParams();
  if (encounterId) params.set('visit', encounterId);
  const query = params.toString();
  return `/patients/${patientId}${query ? `?${query}` : ''}`;
}

