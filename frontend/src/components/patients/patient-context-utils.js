export function getAppointmentPatientId(appointment) {
  const participant = appointment?.participant?.find((item) =>
    item.actor?.reference?.startsWith('Patient/')
  );
  return participant?.actor?.reference?.split('/')[1] || null;
}
