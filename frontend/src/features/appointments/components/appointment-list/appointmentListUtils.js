import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';

export function formatAppointmentDateTime(dateTimeString) {
  if (!dateTimeString) return 'N/A';
  try {
    const dateTime = parseISO(dateTimeString);
    return format(dateTime, 'MMM d, yyyy h:mm a');
  } catch {
    return 'Invalid date';
  }
}

export function getPatientName(appointment) {
  if (!appointment) return 'Unknown Patient';
  if (appointment.patient_name) return appointment.patient_name;
  if (appointment.patient_details?.user_details) {
    const first = appointment.patient_details.user_details.first_name || '';
    const last = appointment.patient_details.user_details.last_name || '';
    const full = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    if (full) return full;
  }
  const patientParticipant = appointment.participant?.find((participant) =>
    participant.actor?.reference?.startsWith('Patient/')
  );
  return patientParticipant?.actor?.display || 'Unknown Patient';
}

export function getPractitionerName(appointment) {
  if (!appointment) return 'Unknown Practitioner';
  if (appointment.practitioner_name) return appointment.practitioner_name;
  if (!appointment.practitioner) return 'Assigned at check-in';
  if (appointment.practitioner_details?.staff_details?.user_details) {
    const first = appointment.practitioner_details.staff_details.user_details.first_name || '';
    const last = appointment.practitioner_details.staff_details.user_details.last_name || '';
    const full = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    if (full) return full;
  }
  const practitionerParticipant = appointment.participant?.find((participant) =>
    participant.actor?.reference?.startsWith('Practitioner/')
  );
  return practitionerParticipant?.actor?.display || 'Unknown Practitioner';
}

export function getStatusConfig(status) {
  switch (status) {
    case 'proposed':
      return { className: 'border-sky-200 bg-sky-50 text-sky-700', label: 'Proposed' };
    case 'pending':
      return { className: 'border-amber-200 bg-amber-50 text-amber-700', label: 'Pending' };
    case 'booked':
      return { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', label: 'Booked' };
    case 'arrived':
      return { className: 'border-amber-200 bg-amber-50 text-amber-700', label: 'Arrived' };
    case 'fulfilled':
      return { className: 'border-emerald-200 bg-emerald-50 text-emerald-700', label: 'Fulfilled' };
    case 'cancelled':
      return { className: 'border-rose-200 bg-rose-50 text-rose-700', label: 'Cancelled' };
    case 'noshow':
      return { className: 'border-border bg-muted text-muted-foreground', label: 'No Show' };
    default:
      return { className: 'border-border bg-muted text-muted-foreground', label: status || 'Unknown' };
  }
}

function getPractitionerSearchText(appointment) {
  if (appointment.practitioner_name) return appointment.practitioner_name;
  if (appointment.practitioner_details?.staff_details?.user_details) {
    const first = appointment.practitioner_details.staff_details.user_details.first_name || '';
    const last = appointment.practitioner_details.staff_details.user_details.last_name || '';
    return `${first} ${last}`.replace(/\s+/g, ' ').trim();
  }
  return (
    appointment.participant?.find((participant) =>
      participant.actor?.reference?.startsWith('Practitioner/')
    )?.actor?.display || ''
  );
}

function matchesSearch(appointment, normalizedSearch) {
  const values = [
    getPatientName(appointment),
    getPractitionerSearchText(appointment),
    appointment.description || '',
    appointment.comment || '',
  ];

  return values.some((value) => value.toLowerCase().includes(normalizedSearch));
}

export function normalizeAppointmentListData(appointmentsData, search, pageSize) {
  let appointments = [];
  let totalPages = 1;

  if (!appointmentsData) {
    return { appointments, totalPages };
  }

  if (appointmentsData.entry) {
    appointments = [];
    for (const entry of appointmentsData.entry) {
      if (entry.resource?.resourceType === 'Appointment') {
        appointments.push(entry.resource);
      }
    }
  } else if (Array.isArray(appointmentsData)) {
    appointments = appointmentsData;
  } else if (appointmentsData.results) {
    appointments = appointmentsData.results;
  }

  if (search) {
    const normalizedSearch = search.toLowerCase();
    appointments = appointments.filter((appointment) =>
      matchesSearch(appointment, normalizedSearch)
    );
  }

  const totalCount = appointmentsData.total || appointments.length;
  totalPages = Math.ceil(totalCount / pageSize);

  return { appointments, totalPages };
}
