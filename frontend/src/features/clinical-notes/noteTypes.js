export const CLINICAL_NOTE_TYPES = Object.freeze({
  DOCTOR: 'doctor_note',
  NURSING: 'nursing_note',
  ALLIED_HEALTH: 'allied_health_note',
});

export const CLINICAL_NOTE_TYPE_LABELS = Object.freeze({
  [CLINICAL_NOTE_TYPES.DOCTOR]: 'Doctor Note',
  [CLINICAL_NOTE_TYPES.NURSING]: 'Nursing Note',
  [CLINICAL_NOTE_TYPES.ALLIED_HEALTH]: 'Allied Health Note',
});

export const CLINICAL_NOTE_TYPE_OPTIONS = Object.freeze([
  {
    value: CLINICAL_NOTE_TYPES.DOCTOR,
    label: CLINICAL_NOTE_TYPE_LABELS[CLINICAL_NOTE_TYPES.DOCTOR],
  },
  {
    value: CLINICAL_NOTE_TYPES.NURSING,
    label: CLINICAL_NOTE_TYPE_LABELS[CLINICAL_NOTE_TYPES.NURSING],
  },
  {
    value: CLINICAL_NOTE_TYPES.ALLIED_HEALTH,
    label: CLINICAL_NOTE_TYPE_LABELS[CLINICAL_NOTE_TYPES.ALLIED_HEALTH],
  },
]);

const NOTE_TYPE_ALIASES = Object.freeze({
  doctor_note: CLINICAL_NOTE_TYPES.DOCTOR,
  doctor: CLINICAL_NOTE_TYPES.DOCTOR,
  physician_note: CLINICAL_NOTE_TYPES.DOCTOR,
  practitioner_note: CLINICAL_NOTE_TYPES.DOCTOR,
  clinical_note: CLINICAL_NOTE_TYPES.DOCTOR,
  general: CLINICAL_NOTE_TYPES.DOCTOR,
  progress: CLINICAL_NOTE_TYPES.DOCTOR,
  progress_note: CLINICAL_NOTE_TYPES.DOCTOR,
  soap: CLINICAL_NOTE_TYPES.DOCTOR,
  soap_note: CLINICAL_NOTE_TYPES.DOCTOR,
  consultation: CLINICAL_NOTE_TYPES.DOCTOR,
  consult: CLINICAL_NOTE_TYPES.DOCTOR,
  consult_note: CLINICAL_NOTE_TYPES.DOCTOR,
  consultation_note: CLINICAL_NOTE_TYPES.DOCTOR,
  admission: CLINICAL_NOTE_TYPES.DOCTOR,
  admission_note: CLINICAL_NOTE_TYPES.DOCTOR,
  discharge: CLINICAL_NOTE_TYPES.DOCTOR,
  discharge_note: CLINICAL_NOTE_TYPES.DOCTOR,
  discharge_summary: CLINICAL_NOTE_TYPES.DOCTOR,
  procedure: CLINICAL_NOTE_TYPES.DOCTOR,
  procedure_note: CLINICAL_NOTE_TYPES.DOCTOR,
  ward_round: CLINICAL_NOTE_TYPES.DOCTOR,
  ward_round_note: CLINICAL_NOTE_TYPES.DOCTOR,
  nursing: CLINICAL_NOTE_TYPES.NURSING,
  nurse_note: CLINICAL_NOTE_TYPES.NURSING,
  nursing_note: CLINICAL_NOTE_TYPES.NURSING,
  allied: CLINICAL_NOTE_TYPES.ALLIED_HEALTH,
  allied_health: CLINICAL_NOTE_TYPES.ALLIED_HEALTH,
  allied_health_note: CLINICAL_NOTE_TYPES.ALLIED_HEALTH,
  physio_note: CLINICAL_NOTE_TYPES.ALLIED_HEALTH,
  physiotherapy_note: CLINICAL_NOTE_TYPES.ALLIED_HEALTH,
  dietetics_note: CLINICAL_NOTE_TYPES.ALLIED_HEALTH,
  counselling_note: CLINICAL_NOTE_TYPES.ALLIED_HEALTH,
});

const NURSING_ROLES = new Set(['nurse', 'head_nurse', 'nurse_practitioner']);
const ALLIED_HEALTH_ROLES = new Set([
  'allied_health',
  'physiotherapist',
  'dietitian',
  'counsellor',
  'counselor',
  'occupational_therapist',
]);

export function normalizeClinicalNoteType(value, fallback = CLINICAL_NOTE_TYPES.DOCTOR) {
  const normalized = String(value || '').trim().toLowerCase();
  return NOTE_TYPE_ALIASES[normalized] || fallback;
}

export function resolveClinicalNoteType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return NOTE_TYPE_ALIASES[normalized] || null;
}

export function clinicalNoteTypeForWrite(value, fallback = CLINICAL_NOTE_TYPES.DOCTOR) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallback;
  }

  const noteType = resolveClinicalNoteType(value);
  if (!noteType) {
    throw new Error('Clinical note type must be doctor_note, nursing_note, or allied_health_note.');
  }
  return noteType;
}

export function clinicalNoteTypeLabel(value) {
  return CLINICAL_NOTE_TYPE_LABELS[normalizeClinicalNoteType(value)] || 'Doctor Note';
}

export function inferClinicalNoteTypeForRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (NURSING_ROLES.has(normalizedRole)) {
    return CLINICAL_NOTE_TYPES.NURSING;
  }
  if (ALLIED_HEALTH_ROLES.has(normalizedRole)) {
    return CLINICAL_NOTE_TYPES.ALLIED_HEALTH;
  }
  return CLINICAL_NOTE_TYPES.DOCTOR;
}
