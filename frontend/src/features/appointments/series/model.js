export const SERIES_LIMIT = 50;
export const SERIES_HORIZON_DAYS = 180;
export const utcDay = () => new Date().toISOString().slice(0, 10);
export function scopeIdentity(user) {
  const capabilities = user?.adminAccess?.capabilities || user?.admin_access?.capabilities || [];
  return JSON.stringify([user?.id, user?.facilityCode, user?.accessContext?.facility_id, user?.accessContext?.active_profile,
    getV2ClientScopeKey(), hashQueryValue(JSON.stringify([...capabilities].sort()))]);
}
export function slotKey(slot) { return JSON.stringify([slot.session_id, slot.start, slot.end]); }
export function buildSeriesPayload(context, rows, clientRequestId, now = Date.now()) {
  if (!context.patientId || !context.clinicId || !context.serviceId) throw new Error('Choose a patient, clinic and appointment type first.');
  if (rows.length < 2 || rows.length > SERIES_LIMIT) throw new Error('Select 2 to 50 appointments for this patient.');
  const ordered = [...rows].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const occurrences = ordered.map((row, index) => {
    const start = Date.parse(row.start); const end = Date.parse(row.end);
    if (!row.session_id || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start <= now || end > now + SERIES_HORIZON_DAYS * 86400000) throw new Error('Choose real future session slots within the next 180 days.');
    if (index && start < Date.parse(ordered[index - 1].end)) throw new Error('Selected appointments must not overlap.');
    const reason = row.overbook_reason?.trim();
    if (row.requires_overbook && !reason) throw new Error('Record an overbooking reason for every slot that requires one.');
    if (reason && new TextEncoder().encode(reason).length > 1000) throw new Error('An overbooking reason is too long. Shorten it before booking.');
    return { session_id: row.session_id, starts_at: row.start, ends_at: row.end, ...(reason ? { overbook_reason: reason } : {}) };
  });
  return { client_request_id: clientRequestId, patient_id: context.patientId, clinic_id: context.clinicId, service_id: context.serviceId, occurrences };
}
export function formatSeriesTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Time unavailable';
}
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
