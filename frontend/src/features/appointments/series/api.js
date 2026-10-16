import { v2Api } from '@/lib/api/v2/client';
const occurrenceTuples = (rows, saved = false) => rows.map((row) => JSON.stringify([saved ? row.clinic_session_id : row.session_id, Date.parse(row.starts_at), Date.parse(row.ends_at)])).sort();
function confirmedSeries(response, expected = {}) {
  const value = response?.data;
  if (!value?.id || !value.patient_id || !value.snapshot_token || !Number.isSafeInteger(value.occurrence_count)
    || value.occurrence_count < 2 || value.occurrence_count > 50 || !Array.isArray(value.appointments)
    || value.appointments.length !== value.occurrence_count || new Set(value.appointments.map((member) => member.id)).size !== value.occurrence_count
    || value.appointments.some((member) => !member.id || !member.clinic_session_id || !Number.isFinite(Date.parse(member.starts_at)) || !Number.isFinite(Date.parse(member.ends_at)) || Date.parse(member.ends_at) <= Date.parse(member.starts_at) || !member.status)
    || (expected.id && value.id !== expected.id) || (expected.patient_id && value.patient_id !== expected.patient_id)
    || (expected.clinic_id && value.clinic_id !== expected.clinic_id) || (expected.service_id && value.service_id !== expected.service_id)
    || (expected.occurrences && (value.occurrence_count !== expected.occurrences.length
      || JSON.stringify(value.appointments.map((member) => member.clinic_session_id).sort()) !== JSON.stringify(expected.occurrences.map((member) => member.session_id).sort())
      || (expected.verifyTimes && JSON.stringify(occurrenceTuples(value.appointments, true)) !== JSON.stringify(occurrenceTuples(expected.occurrences)))))) throw new Error('The appointment group response could not be confirmed.');
  return value;
}
function uncertain(error) {
  const code = error?.data?.error?.code || error?.code || '';
  return !error?.status || error.status >= 500 || code.endsWith('_unconfirmed');
}
async function write(operation) {
  try { return await operation(); }
  catch (error) {
    if (!uncertain(error)) throw error;
    const result = new Error('The change may already be saved. Review the saved result or explicitly retry this same request.');
    result.name = 'AppointmentSeriesUnconfirmedError'; throw result;
  }
}
export const seriesApi = {
  // A first create must confirm the selected slots. Explicit original-key
  // recovery can return later reschedules while preserving immutable membership.
  async create(payload, { signal, currentMembership = false } = {}) { return write(async () => confirmedSeries(await v2Api.postSchedulingAppointmentSeries(payload, { signal }), { ...payload, verifyTimes: !currentMembership })); },
  async get(id, { signal } = {}) { return confirmedSeries(await v2Api.getSchedulingAppointmentSeriesById({ id }, { signal }), { id }); },
  async recover(clientRequestId, { signal, expected } = {}) { return confirmedSeries(await v2Api.getSchedulingAppointmentSeriesByRequest({ client_request_id: clientRequestId }, { signal }), expected); },
  async cancel(id, payload, { signal } = {}) {
    return write(async () => {
      const response = await v2Api.postSchedulingAppointmentSeriesCancelFuture({ id }, payload, { signal });
      const value = response?.data;
      const series = confirmedSeries({ data: value?.series }, { id });
      const changed = value.cancelled_appointment_ids; const retained = value.retained_appointment_ids;
      const ids = new Set(series.appointments.map((member) => member.id));
      if (!Number.isFinite(Date.parse(value.cutoff_at)) || !Array.isArray(changed) || !Array.isArray(retained)
        || value.cancelled_count !== changed.length || new Set([...changed, ...retained]).size !== ids.size
        || changed.length + retained.length !== ids.size || [...changed, ...retained].some((member) => !ids.has(member))
        || changed.some((member) => series.appointments.find((row) => row.id === member)?.status !== 'cancelled')) throw new Error('The saved cancellation receipt could not be confirmed.');
      return { ...value, series };
    });
  },
  async slots(query, { signal } = {}) {
    const response = await v2Api.getSchedulingAvailability({ query: { ...query, limit: 100 }, signal });
    if (!Array.isArray(response?.data?.slots) || response.data.slots.some((slot) => !slot.session_id || !Number.isFinite(Date.parse(slot.start)) || !Number.isFinite(Date.parse(slot.end)) || Date.parse(slot.end) <= Date.parse(slot.start)
      || slot.clinic_id !== query.clinic_id || !Number.isSafeInteger(slot.capacity?.remaining) || slot.capacity.remaining < 0 || !Number.isSafeInteger(slot.capacity?.overbook_remaining) || slot.capacity.overbook_remaining < 0)) throw new Error('Current session availability could not be confirmed.');
    return response.data.slots;
  },
};
