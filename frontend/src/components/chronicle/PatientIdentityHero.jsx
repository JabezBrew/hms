import { PatientIdentityHeroLayout } from "./PatientIdentityHeroSections";

const DEFAULT_EMPTY_ARRAY = [];

function getDisplayName(patient) {
  if (patient?.local_data?.user_details) {
    const { first_name, last_name } = patient.local_data.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
  }
  if (patient?.fhir_data?.name?.[0]) {
    const fhirName = patient.fhir_data.name[0];
    const given = fhirName.given?.join(' ') || '';
    const family = fhirName.family || '';
    return `${given} ${family}`.trim() || "Unknown Patient";
  }
  if (patient?.user_details) {
    const { first_name, last_name } = patient.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
  }
  if (patient?.patient_profile_details?.user_details) {
    const { first_name, last_name } = patient.patient_profile_details.user_details;
    return `${first_name || ''} ${last_name || ''}`.trim() || "Unknown Patient";
  }
  if (patient?.name) return patient.name;
  if (patient?.full_name) return patient.full_name;
  return "Unknown Patient";
}

function getPatientMRN(patient) {
  if (patient?.local_data?.medical_record_number) {
    return patient.local_data.medical_record_number;
  }
  if (patient?.fhir_data?.identifier) {
    const mrnIdentifier = patient.fhir_data.identifier.find(
      id => id.system?.includes('mrn') || id.type?.coding?.[0]?.code === 'MR'
    );
    if (mrnIdentifier?.value) return mrnIdentifier.value;
  }
  return patient?.medical_record_number ||
    patient?.patient_profile_details?.medical_record_number ||
    patient?.mrn ||
    "No MRN";
}

function getPatientAge(patient) {
  const dob = patient?.local_data?.user_details?.date_of_birth ||
    patient?.fhir_data?.birthDate ||
    patient?.user_details?.date_of_birth ||
    patient?.patient_profile_details?.user_details?.date_of_birth ||
    patient?.date_of_birth;

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
  const gender = patient?.local_data?.user_details?.gender ||
    patient?.fhir_data?.gender ||
    patient?.user_details?.gender ||
    patient?.patient_profile_details?.user_details?.gender ||
    patient?.gender;

  if (gender === 'M' || gender === 'male') return 'Male';
  if (gender === 'F' || gender === 'female') return 'Female';
  if (gender === 'O' || gender === 'other') return 'Other';
  return null;
}

function getPatientDOB(patient) {
  const dob = patient?.local_data?.user_details?.date_of_birth ||
    patient?.fhir_data?.birthDate ||
    patient?.user_details?.date_of_birth ||
    patient?.patient_profile_details?.user_details?.date_of_birth ||
    patient?.date_of_birth;

  if (!dob) return null;

  try {
    return new Date(dob).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return null;
  }
}

function getPatientPhone(patient) {
  if (patient?.local_data?.user_details?.phone_number) {
    return patient.local_data.user_details.phone_number;
  }
  if (patient?.fhir_data?.telecom) {
    const phone = patient.fhir_data.telecom.find(t => t.system === 'phone');
    if (phone?.value) return phone.value;
  }
  return patient?.user_details?.phone ||
    patient?.user_details?.phone_number ||
    patient?.patient_profile_details?.user_details?.phone ||
    patient?.phone ||
    null;
}

function getPatientWard(patient) {
  return patient?.local_data?.current_ward ||
    patient?.current_ward ||
    patient?.patient_profile_details?.current_ward ||
    null;
}

function getPatientBed(patient) {
  return patient?.local_data?.current_bed ||
    patient?.current_bed ||
    patient?.patient_profile_details?.current_bed ||
    null;
}

function getAllergies(patient) {
  const localAllergies = patient?.local_data?.allergies;
  if (localAllergies) {
    if (typeof localAllergies === 'string') {
      return localAllergies.split(',').flatMap((allergy) => {
        const trimmed = allergy.trim();
        return trimmed ? [trimmed] : [];
      });
    }
    return localAllergies;
  }
  return patient?.allergies ||
    patient?.patient_profile_details?.allergies ||
    [];
}

function getPatientStatus(patient) {
  if (patient?.is_critical || patient?.local_data?.is_critical) return 'critical';
  if (patient?.has_alerts || patient?.local_data?.has_alerts) return 'warning';
  return 'stable';
}

const PatientIdentityHero = ({
  patient,
  onAddNote,
  onRecordVitals,
  onPrescribe,
  onAskChronicle,
  onOrderLabs,
  onRequestConsult,
  onShareRecord,
  onReceiveRecord,
  onActionIntent,
  onScheduleFollowUp,
  onViewTreatmentSheet,
  onViewMedicationHistory,
  onRecordFluids,
  onStartWardRound,
  onStartDischarge,
  onManageInsurance,
  onPrintSummary,
  insurance = DEFAULT_EMPTY_ARRAY,
  activeAdmission,
  activeVisit,
  allergies: clinicalAllergies = DEFAULT_EMPTY_ARRAY,
  className
}) => {
  const ward = getPatientWard(patient);
  const bed = getPatientBed(patient);
  const suppliedAllergies = Array.isArray(clinicalAllergies) ? clinicalAllergies : [];
  const allergies = suppliedAllergies.length > 0 ? suppliedAllergies : getAllergies(patient);
  const location = ward ? `${ward}${bed ? `, Bed ${bed}` : ''}` : null;

  const prefetchAction = (action) => {
    if (onActionIntent) {
      onActionIntent(action);
    }
  };

  return (
    <PatientIdentityHeroLayout
      actions={{
        onAddNote,
        onAskChronicle,
        onManageInsurance,
        onOrderLabs,
        onPrescribe,
        onPrintSummary,
        onReceiveRecord,
        onRecordFluids,
        onRecordVitals,
        onRequestConsult,
        onScheduleFollowUp,
        onShareRecord,
        onStartDischarge,
        onStartWardRound,
        onViewMedicationHistory,
        onViewTreatmentSheet,
      }}
      className={className}
      clinicalContext={{
        activeAdmission,
        activeVisit,
        insurance,
      }}
      patientSummary={{
        age: getPatientAge(patient),
        allergies,
        displayName: getDisplayName(patient),
        dob: getPatientDOB(patient),
        gender: getPatientGender(patient),
        location,
        mrn: getPatientMRN(patient),
        phone: getPatientPhone(patient),
        status: getPatientStatus(patient),
      }}
      prefetchAction={prefetchAction}
    />
  );
};

export default PatientIdentityHero;
export { PatientIdentityHero };
