import { describe, expect, it } from 'vitest';
import { buildSeriesPayload } from '../model';
const now = Date.parse('2026-10-16T00:00:00Z');
const context = { patientId: 'patient-opaque', clinicId: 'clinic-opaque', serviceId: 'service-opaque' };
const slot = (day, hour = 9) => ({ session_id: `session-${day}-${hour}`, start: `2026-10-${day}T${String(hour).padStart(2, '0')}:00:00Z`, end: `2026-10-${day}T${String(hour + 1).padStart(2, '0')}:00:00Z` });
describe('explicit appointment-group payload', () => {
  it('sorts actual slots and sends no inferred practitioner or recurrence defaults', () => {
    const result = buildSeriesPayload(context, [slot(18), { ...slot(17), requires_overbook: true, overbook_reason: ' Reviewed capacity ' }], 'stable-key', now);
    expect(result).toEqual({ client_request_id: 'stable-key', patient_id: context.patientId, clinic_id: context.clinicId, service_id: context.serviceId, occurrences: [{ session_id: 'session-17-9', starts_at: '2026-10-17T09:00:00Z', ends_at: '2026-10-17T10:00:00Z', overbook_reason: 'Reviewed capacity' }, { session_id: 'session-18-9', starts_at: '2026-10-18T09:00:00Z', ends_at: '2026-10-18T10:00:00Z' }] });
  });
  it('rejects missing context, one or too many slots, overlaps, manual slots and past or distant dates', () => {
    expect(() => buildSeriesPayload({}, [slot(17), slot(18)], 'key', now)).toThrow(/patient, clinic/);
    expect(() => buildSeriesPayload(context, [slot(17)], 'key', now)).toThrow(/2 to 50/);
    expect(() => buildSeriesPayload(context, Array(51).fill(slot(17)), 'key', now)).toThrow(/2 to 50/);
    expect(() => buildSeriesPayload(context, [slot(17), slot(17)], 'key', now)).toThrow(/overlap/);
    expect(() => buildSeriesPayload(context, [{ ...slot(17), session_id: null }, slot(18)], 'key', now)).toThrow(/real future/);
    expect(() => buildSeriesPayload(context, [slot(15), slot(18)], 'key', now)).toThrow(/real future/);
    expect(() => buildSeriesPayload(context, [slot(17), { ...slot(18), start: '2028-10-18T09:00:00Z', end: '2028-10-18T10:00:00Z' }], 'key', now)).toThrow(/180 days/);
    expect(() => buildSeriesPayload(context, [{ ...slot(17), requires_overbook: true }, slot(18)], 'key', now)).toThrow(/overbooking reason/);
    expect(() => buildSeriesPayload(context, [{ ...slot(17), requires_overbook: true, overbook_reason: '🙂'.repeat(300) }, slot(18)], 'key', now)).toThrow(/too long/);
  });
});
