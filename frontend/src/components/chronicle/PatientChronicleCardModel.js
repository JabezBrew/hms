function getPatientId(patient) {
  if (patient?.id) return patient.id;
  if (patient?.patient_profile) return patient.patient_profile;
  if (patient?.local_data?.id) return patient.local_data.id;
  if (patient?.fhir_data?.id) return patient.fhir_data.id;
  return null;
}

function getDisplayName(patient) {
  if (patient?.name) {
    return patient.name;
  }
  if (patient?.user_details) {
    const { first_name, last_name } = patient.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || 'Unknown Patient';
  }
  if (patient?.patient_profile_details?.user_details) {
    const { first_name, last_name } = patient.patient_profile_details.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || 'Unknown Patient';
  }
  if (patient?.local_data?.user_details) {
    const { first_name, last_name } = patient.local_data.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || 'Unknown Patient';
  }
  return 'Unknown Patient';
}

function getPatientMRN(patient) {
  return patient?.medical_record_number ||
    patient?.patient_profile_details?.medical_record_number ||
    patient?.local_data?.medical_record_number ||
    'No MRN';
}

function getPatientAge(patient) {
  const dob = patient?.user_details?.date_of_birth ||
    patient?.patient_profile_details?.user_details?.date_of_birth ||
    patient?.local_data?.user_details?.date_of_birth;

  if (!dob) return null;

  try {
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  } catch {
    return null;
  }
}

function getPatientGender(patient) {
  const gender = patient?.user_details?.gender ||
    patient?.patient_profile_details?.user_details?.gender ||
    patient?.local_data?.user_details?.gender;

  if (gender === 'M') return 'M';
  if (gender === 'F') return 'F';
  return null;
}

function getPatientWard(patient) {
  return patient?.current_ward ||
    patient?.patient_profile_details?.current_ward ||
    patient?.local_data?.current_ward ||
    null;
}

function getPatientBed(patient) {
  return patient?.current_bed ||
    patient?.patient_profile_details?.current_bed ||
    patient?.local_data?.current_bed ||
    null;
}

function getAdmissionDays(patient) {
  const admissionDate = patient?.admission_date ||
    patient?.patient_profile_details?.admission_date ||
    patient?.local_data?.admission_date;

  if (!admissionDate) return null;

  try {
    const admission = new Date(admissionDate);
    const today = new Date();
    const diffTime = Math.abs(today - admission);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function getAllergies(patient) {
  return patient?.allergies ||
    patient?.patient_profile_details?.allergies ||
    patient?.local_data?.allergies ||
    [];
}

function getPrimaryDiagnosis(patient) {
  return patient?.primary_diagnosis ||
    patient?.patient_profile_details?.primary_diagnosis ||
    patient?.local_data?.primary_diagnosis ||
    patient?.chief_complaint ||
    null;
}

function getAttendingPhysician(patient) {
  return patient?.attending_physician ||
    patient?.patient_profile_details?.attending_physician ||
    null;
}

function getVitals(patient) {
  return patient?.latest_vitals ||
    patient?.vitals ||
    null;
}

function getPatientStatus(patient) {
  const vitals = getVitals(patient);
  if (patient?.is_critical || vitals?.is_critical) return 'critical';
  if (patient?.has_alerts || patient?.pending_orders > 0) return 'warning';
  return 'stable';
}

function getPendingOrders(patient) {
  return patient?.pending_orders || 0;
}

function getIsAdmitted(patient) {
  return !!(
    patient?.current_admission_id ||
    patient?.local_data?.current_admission_id ||
    patient?.patient_profile_details?.current_admission_id ||
    patient?.admission_status === 'admitted' ||
    patient?.local_data?.admission_status === 'admitted'
  );
}

export function buildPatientChronicleCardModel(patient) {
  const patientId = getPatientId(patient);
  const displayName = getDisplayName(patient);
  const mrn = getPatientMRN(patient);
  const age = getPatientAge(patient);
  const gender = getPatientGender(patient);
  const ward = getPatientWard(patient);
  const bed = getPatientBed(patient);
  const admissionDays = getAdmissionDays(patient);
  const allergies = getAllergies(patient);
  const primaryDx = getPrimaryDiagnosis(patient);
  const attending = getAttendingPhysician(patient);
  const vitals = getVitals(patient);
  const status = getPatientStatus(patient);
  const pendingOrders = getPendingOrders(patient);
  const isAdmitted = getIsAdmitted(patient);
  const location = [ward, bed ? `Bed ${bed}` : null].filter(Boolean).join(', ');
  const demographics = [
    mrn,
    age ? `${age}${gender || ''}` : null,
    location || null,
  ].filter(Boolean).join(' · ');

  return {
    patientId,
    displayName,
    mrn,
    ward,
    admissionDays,
    allergies,
    primaryDx,
    attending,
    vitals,
    status,
    pendingOrders,
    isAdmitted,
    isPinned: patient?._isPinned,
    demographics,
  };
}
