export function buildAdmissionPatientOptions(patients) {
  return Array.isArray(patients) ? patients.flatMap((patient) => {
    let name = "Unknown Patient";
    let id = "";

    // Use the local database ID, not the FHIR ID. The backend expects PatientProfile ID.
    if (patient?.id) {
      id = patient.id;
    } else if (patient?.local_data?.id) {
      id = patient.local_data.id;
    }

    if (patient?.name) {
      name = patient.name;
    } else if (patient?.fhir_resource?.name?.[0]) {
      const given = patient.fhir_resource.name[0].given?.join(' ') || "";
      const family = patient.fhir_resource.name[0].family || "";
      name = `${family}, ${given}`.trim() || "Unknown Patient";
    } else if (patient?.local_data?.user_details) {
      name = `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim() || "Unknown Patient";
    } else if (patient?.user?.full_name) {
      name = patient.user.full_name;
    }

    return (id && id !== '' && id !== 0) ? [{
      label: name,
      value: id,
    }] : [];
  }) : [];
}

export function buildAdmissionPractitionerOptions(practitioners) {
  return Array.isArray(practitioners) ? practitioners.flatMap((practitioner) => {
    let displayName = 'Unknown Practitioner';
    let id = null;

    if (practitioner?.local_data?.id) {
      id = practitioner.local_data.id;
    } else if (practitioner?.id) {
      id = practitioner.id;
    }

    if (!id || id === '' || id === 0) return [];

    if (practitioner.fhir_resource?.name?.[0]) {
      const name = practitioner.fhir_resource.name[0];
      const given = name?.given?.join(' ') || '';
      const family = name?.family || '';
      const specialization = practitioner.local_data?.specialization || 'Doctor';
      displayName = `${given} ${family} - ${specialization}`.trim();
    } else if (practitioner.local_data?.staff_details) {
      const firstName = practitioner.local_data.staff_details?.user_details?.first_name || '';
      const lastName = practitioner.local_data.staff_details?.user_details?.last_name || '';
      const specialization = practitioner.local_data?.specialization || 'Doctor';
      displayName = `${firstName} ${lastName} - ${specialization}`.replace(/\s+/g, ' ').trim();
    } else if (practitioner.staff_details) {
      displayName = `${practitioner.staff_details?.user_details?.first_name} ${practitioner.staff_details?.user_details?.last_name} - ${practitioner.staff_details?.specialization || 'Doctor'}`.replace(/\s+/g, ' ').trim();
    } else if (practitioner.user?.full_name) {
      displayName = `${practitioner.user.full_name} - ${practitioner.specialization || 'Doctor'}`;
    }

    return [{
      label: displayName,
      value: id,
    }];
  }) : [];
}
