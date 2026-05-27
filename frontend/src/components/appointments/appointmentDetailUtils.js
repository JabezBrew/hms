import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import isValid from 'date-fns/isValid';

export const appointmentStatusConfig = {
  proposed: {
    badge: "bg-[oklch(0.70_0.15_230_/_0.15)] text-[oklch(0.70_0.15_230)] border-[oklch(0.70_0.15_230_/_0.3)]",
    dot: "bg-[oklch(0.70_0.15_230)]",
    label: "Proposed",
  },
  pending: {
    badge: "bg-[oklch(0.75_0.18_55_/_0.15)] text-[oklch(0.65_0.18_55)] border-[oklch(0.75_0.18_55_/_0.3)]",
    dot: "bg-[oklch(0.75_0.18_55)]",
    label: "Pending",
  },
  booked: {
    badge: "bg-[oklch(0.70_0.17_155_/_0.15)] text-[oklch(0.55_0.17_155)] border-[oklch(0.70_0.17_155_/_0.3)]",
    dot: "bg-[oklch(0.70_0.17_155)]",
    label: "Booked",
  },
  arrived: {
    badge: "bg-[oklch(0.75_0.18_55_/_0.15)] text-[oklch(0.65_0.18_55)] border-[oklch(0.75_0.18_55_/_0.3)]",
    dot: "bg-[oklch(0.75_0.18_55)]",
    label: "Arrived",
  },
  fulfilled: {
    badge: "bg-[oklch(0.70_0.17_155_/_0.15)] text-[oklch(0.55_0.17_155)] border-[oklch(0.70_0.17_155_/_0.3)]",
    dot: "bg-[oklch(0.70_0.17_155)]",
    label: "Fulfilled",
  },
  cancelled: {
    badge: "bg-[oklch(0.65_0.22_15_/_0.15)] text-[oklch(0.55_0.22_15)] border-[oklch(0.65_0.22_15_/_0.3)]",
    dot: "bg-[oklch(0.65_0.22_15)]",
    label: "Cancelled",
  },
  noshow: {
    badge: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
    label: "No Show",
  },
};

const TERMINAL_RUST_V2_STATUSES = new Set(['arrived', 'fulfilled', 'cancelled', 'noshow']);

const safeParseAppointmentDate = (value) => {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = parseISO(value);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const formatAppointmentDateTime = (dateTimeString) => {
  const dateTime = safeParseAppointmentDate(dateTimeString);
  return dateTime ? format(dateTime, 'MMMM d, yyyy h:mm a') : dateTimeString ? 'Invalid date' : 'N/A';
};

export const getAppointmentRange = (appointment) => {
  const startAt = appointment?.start ?? appointment?.start_time ?? null;
  const endAt = appointment?.end ?? appointment?.end_time ?? null;

  return {
    endAt,
    endDate: safeParseAppointmentDate(endAt),
    startAt,
    startDate: safeParseAppointmentDate(startAt),
  };
};

export const getAppointmentPatient = (appointment) => {
  if (!appointment) return { name: 'Unknown', id: '' };

  const localPatient = appointment.patient_details || appointment.patient;
  if (appointment.patient_details?.user_details) {
    const first = appointment.patient_details.user_details.first_name || '';
    const last = appointment.patient_details.user_details.last_name || '';
    const name = `${first} ${last}`.replace(/\s+/g, ' ').trim() || 'Unknown Patient';
    const id = appointment.patient_details.id || appointment.patient || '';
    return { name, id: String(id || '') };
  }
  if (appointment.patient_name) {
    const id = appointment.patient_details?.id || appointment.patient || '';
    return { name: appointment.patient_name, id: String(id || '') };
  }
  if (localPatient && typeof localPatient === 'string') {
    return { name: 'Unknown Patient', id: localPatient };
  }

  const patientParticipant = appointment.participant?.find((participant) =>
    participant.actor?.reference?.startsWith('Patient/')
  );

  if (!patientParticipant) return { name: 'Unknown', id: '' };

  const reference = patientParticipant.actor?.reference || '';
  const id = reference.split('/')[1] || '';
  const name = patientParticipant.actor?.display || 'Unknown Patient';

  return { name, id };
};

export const getAppointmentPractitioner = (appointment) => {
  if (!appointment) return { name: 'Unknown', id: '' };

  if (appointment.practitioner_details?.staff_details?.user_details) {
    const first = appointment.practitioner_details.staff_details.user_details.first_name || '';
    const last = appointment.practitioner_details.staff_details.user_details.last_name || '';
    const name = `${first} ${last}`.replace(/\s+/g, ' ').trim() || 'Unknown Practitioner';
    const id = appointment.practitioner_details.id || appointment.practitioner || '';
    return { name, id: String(id || '') };
  }
  if (appointment.practitioner_name) {
    const id = appointment.practitioner_details?.id || appointment.practitioner || '';
    return { name: appointment.practitioner_name, id: String(id || '') };
  }
  if (!appointment.practitioner) {
    return { name: 'Assigned at check-in', id: '' };
  }
  if (appointment.practitioner && typeof appointment.practitioner === 'string') {
    return { name: 'Unknown Practitioner', id: appointment.practitioner };
  }

  const practitionerParticipant = appointment.participant?.find((participant) =>
    participant.actor?.reference?.startsWith('Practitioner/')
  );

  if (!practitionerParticipant) return { name: 'Unknown', id: '' };

  const reference = practitionerParticipant.actor?.reference || '';
  const id = reference.split('/')[1] || '';
  const name = practitionerParticipant.actor?.display || 'Unknown Practitioner';

  return { name, id };
};

export const getAppointmentType = (appointment) => {
  if (!appointment) return 'General';

  if (appointment.appointment_type_details?.name) {
    return appointment.appointment_type_details.name;
  }
  if (appointment.appointment_type_name) {
    return appointment.appointment_type_name;
  }

  return appointment.appointmentType?.coding?.[0]?.display || 'General';
};

export const getAppointmentDuration = (startDate, endDate) => {
  if (!startDate || !endDate) return 'N/A';

  const durationMs = endDate.getTime() - startDate.getTime();
  const durationMinutes = Math.round(durationMs / (1000 * 60));

  return `${durationMinutes} minutes`;
};

export const getAppointmentActionState = (appointment, rustV2Mode) => ({
  canCancelInRustV2: rustV2Mode
    && (appointment.v2_status === 'scheduled' || appointment.status === 'booked'),
  canCheckInInRustV2: rustV2Mode && !TERMINAL_RUST_V2_STATUSES.has(appointment.status),
  canEditInRustV2: !rustV2Mode
    || appointment.v2_status === 'scheduled'
    || appointment.status === 'booked',
  rustV2Mode,
});
