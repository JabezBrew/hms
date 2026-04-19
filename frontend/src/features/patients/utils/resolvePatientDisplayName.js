function normalizeName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/\s+/g, ' ').trim();
}

function buildName(firstName, lastName) {
  return normalizeName(`${firstName || ''} ${lastName || ''}`);
}

export function resolvePatientDisplayName(patient) {
  if (!patient || typeof patient !== 'object') {
    return '';
  }

  const nameFromUserDetails = buildName(
    patient?.local_data?.user_details?.first_name,
    patient?.local_data?.user_details?.last_name,
  );
  if (nameFromUserDetails) {
    return nameFromUserDetails;
  }

  const nameFromDirectUserDetails = buildName(
    patient?.user_details?.first_name,
    patient?.user_details?.last_name,
  );
  if (nameFromDirectUserDetails) {
    return nameFromDirectUserDetails;
  }

  const nameFromPatientProfileDetails = buildName(
    patient?.patient_profile_details?.user_details?.first_name,
    patient?.patient_profile_details?.user_details?.last_name,
  );
  if (nameFromPatientProfileDetails) {
    return nameFromPatientProfileDetails;
  }

  const nameFromUser = buildName(patient?.user?.first_name, patient?.user?.last_name);
  if (nameFromUser) {
    return nameFromUser;
  }

  const fhirName = patient?.fhir_data?.name?.[0];
  if (fhirName) {
    const given = Array.isArray(fhirName.given) ? fhirName.given.join(' ') : fhirName.given;
    const nameFromFhir = buildName(given, fhirName.family);
    if (nameFromFhir) {
      return nameFromFhir;
    }
  }

  const fallbackCandidates = [
    patient?.full_name,
    patient?.display_name,
    patient?.name,
    patient?.local_data?.full_name,
    patient?.local_data?.name,
  ];

  for (const candidate of fallbackCandidates) {
    const normalized = normalizeName(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}
