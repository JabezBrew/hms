import * as z from 'zod';

export const appointmentCreateFormSchema = z.object({
  patientId: z.string({
    required_error: 'Please select a patient',
  }),
  clinicId: z.string({
    required_error: 'Please select a clinic',
  }),
  practitionerId: z.string().optional(),
  appointmentTypeId: z.string({
    required_error: 'Please select an appointment type',
  }),
  slotId: z.string().optional(),
  description: z.string().optional(),
  comment: z.string().optional(),
  overbookReason: z.string().optional(),
});

export function getAppointmentCreateInitialData(search, routeState) {
  const params = new URLSearchParams(search || '');
  return {
    patientId: params.get('patient') || params.get('patientId') || '',
    clinicId: params.get('clinic') || params.get('clinicId') || '',
    practitionerId: params.get('practitioner') || params.get('practitionerId') || '',
    appointmentTypeId: params.get('appointment_type') || params.get('appointmentTypeId') || '',
    slotId: params.get('slot') || params.get('slotId') || '',
    waitlistId: params.get('waitlist') || params.get('waitlistId') || '',
    description: params.get('description') || '',
    comment: params.get('comment') || '',
    overbookReason: params.get('overbook_reason') || params.get('overbookReason') || '',
    ...(routeState || {}),
  };
}

export function getAppointmentCreateDefaultValues(initialData) {
  return {
    patientId: initialData.patientId || '',
    clinicId: initialData.clinicId || '',
    practitionerId: initialData.practitionerId || '',
    appointmentTypeId: initialData.appointmentTypeId || '',
    slotId: initialData.slotId || '',
    description: initialData.description || '',
    comment: initialData.comment || '',
    overbookReason: initialData.overbookReason || '',
  };
}

export function slotRequiresOverbookReason(slot) {
  const capacity = slot?.capacity || null;
  const remaining = Number(capacity?.remaining ?? 0);
  const overbookRemaining = Number(capacity?.overbook_remaining ?? 0);
  return slot?.status === 'overbook_available' || (remaining <= 0 && overbookRemaining > 0);
}

export function getAppointmentCreateProgress({
  appointmentTypeId,
  clinicId,
  patientId,
  practitionerId,
  requiresPractitioner,
  slotId,
}) {
  const total = requiresPractitioner ? 5 : 4;
  let completed = 0;
  if (patientId) completed += 1;
  if (clinicId) completed += 1;
  if (requiresPractitioner && practitionerId) completed += 1;
  if (appointmentTypeId) completed += 1;
  if (slotId) completed += 1;

  return { completed, total };
}

export function getPatientOption(patient) {
  if (patient?.name) {
    return { label: patient.name, value: patient.id };
  }

  if (patient?.fhir_resource?.name?.[0]) {
    const given = patient.fhir_resource.name[0].given?.join(' ') || '';
    const family = patient.fhir_resource.name[0].family || '';
    const name = `${family}, ${given}`.trim() || 'Unknown Patient';
    return { label: name, value: patient.local_data?.id || patient.fhir_resource.id };
  }

  if (patient?.local_data?.user_details) {
    const user = patient.local_data.user_details;
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown Patient';
    return { label: name, value: patient.local_data.id };
  }

  return {
    label: patient?.user?.full_name || 'Unknown Patient',
    value: patient?.id || '',
  };
}

export function getPractitionerOption(practitioner) {
  if (practitioner?.name) {
    return { label: `Dr. ${practitioner.name}`, value: practitioner.id };
  }

  if (practitioner?.fhir_resource) {
    const name = practitioner.fhir_resource.name?.[0];
    const given = name?.given?.join(' ') || '';
    const family = name?.family || '';
    const displayName = `Dr. ${given} ${family}`.trim();
    return {
      label: displayName,
      value: practitioner.local_data?.id || practitioner.fhir_resource.id,
    };
  }

  if (practitioner?.staff_details) {
    const user = practitioner.staff_details?.user_details;
    return {
      label: `Dr. ${user?.first_name || ''} ${user?.last_name || ''}`.replace(/\s+/g, ' ').trim(),
      value: practitioner.id,
    };
  }

  return {
    label: practitioner?.user?.full_name || 'Unknown Practitioner',
    value: practitioner?.id || '',
  };
}

function matchesEntityId(item, id) {
  if (item?.local_data?.id === id) return true;
  if (item?.fhir_resource?.id === id) return true;
  if (item?.id === id) return true;
  return false;
}

export function getSelectedPatientName(patientId, patients) {
  if (!patientId || patients.length === 0) return null;
  const patient = patients.find((item) => matchesEntityId(item, patientId));
  if (!patient) return null;

  if (patient?.name) return patient.name;

  if (patient?.fhir_resource?.name?.[0]) {
    const given = patient.fhir_resource.name[0].given?.join(' ') || '';
    const family = patient.fhir_resource.name[0].family || '';
    return `${given} ${family}`.trim();
  }

  if (patient?.local_data?.user_details) {
    const user = patient.local_data.user_details;
    return `${user.first_name || ''} ${user.last_name || ''}`.trim();
  }

  return patient?.user?.full_name || null;
}

export function getSelectedPractitionerName(practitionerId, practitioners) {
  if (!practitionerId || practitioners.length === 0) return null;
  const practitioner = practitioners.find((item) => matchesEntityId(item, practitionerId));
  if (!practitioner) return null;

  if (practitioner?.name) return `Dr. ${practitioner.name}`;

  if (practitioner?.fhir_resource?.name?.[0]) {
    const given = practitioner.fhir_resource.name[0].given?.join(' ') || '';
    const family = practitioner.fhir_resource.name[0].family || '';
    return `Dr. ${given} ${family}`.trim();
  }

  if (practitioner?.staff_details?.user_details) {
    const user = practitioner.staff_details.user_details;
    return `Dr. ${user.first_name || ''} ${user.last_name || ''}`.trim();
  }

  return practitioner?.user?.full_name ? `Dr. ${practitioner.user.full_name}` : null;
}

export function getSelectedAppointmentTypeName(appointmentTypeId, appointmentTypes) {
  if (!appointmentTypeId) return null;
  const type = appointmentTypes.find((item) => item.id === appointmentTypeId);
  return type?.name || null;
}

export function buildAppointmentPayload({
  data,
  isWaitlistPromotion,
  requiresPractitioner,
  selectedClinic,
  selectedSlot,
  selectedSlotRequiresOverbook,
}) {
  const appointmentData = {
    patient: data.patientId,
    clinic: data.clinicId,
    appointment_type: data.appointmentTypeId,
    clinic_session: selectedSlot.session_id,
    starts_at: selectedSlot.start,
    ends_at: selectedSlot.end,
    reason: data.description,
    notes: data.comment,
  };

  if (requiresPractitioner) {
    appointmentData.practitioner = data.practitionerId;
  }

  if (selectedSlotRequiresOverbook) {
    appointmentData.overbook_reason = data.overbookReason?.trim();
  }

  if (selectedClinic?.waitlist_enabled && !isWaitlistPromotion) {
    appointmentData.auto_waitlist = true;
  }

  return appointmentData;
}
