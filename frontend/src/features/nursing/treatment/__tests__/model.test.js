import { describe, expect, it } from 'vitest';
import { canUseTreatmentCourses } from '../access';
import { commandPayload, instant, sameInstant, utcTime } from '../model';
import { contextEvidence, courseCounts, courseDetail, courseDose, coursePage } from '../contracts';
import { courseReceipt } from '../receipts';
import { actorId, caseId, ids, scope, user, command, context, counts, detail, dose, header, receipt } from './fixtures';

it('requires actual View, Full and all three features rather than inferred role or Manage', () => {
  expect(canUseTreatmentCourses(user, true)).toBe(true); expect(canUseTreatmentCourses(user, false)).toBe(false); expect(canUseTreatmentCourses({ role: 'admin' }, true)).toBe(false);
  expect(canUseTreatmentCourses({ ...user, adminAccess: { capabilities: ['clinical_documentation.manage'] } }, true)).toBe(false);
  expect(canUseTreatmentCourses({ ...user, accessContext: { ...user.accessContext, features: ['patients', 'encounters'] } }, true)).toBe(false);
});
it('normalizes a required reason without changing source/case tokens and bounds UTF-8 bytes', () => {
  expect(commandPayload('stop', detail(), context(), { reason: '  Reviewed local reason  ' }, ids[12])).toEqual({ ...command().payload, reason: 'Reviewed local reason' });
  expect(() => commandPayload('stop', detail(), context(), { reason: ' ' }, ids[12])).toThrow('reason');
  expect(() => commandPayload('stop', detail(), context(), { reason: 'é'.repeat(1001) }, ids[12])).toThrow('too long');
  expect(() => commandPayload('stop', detail(), context({ context_token: 'e'.repeat(64) }), { reason: 'Reviewed' }, ids[12])).toThrow('Reload');
});
it('requires an explicit valid UTC next boundary and never infers a dose quantity', () => {
  const value = commandPayload('window', detail(), context(), { scheduled_before: '2030-05-19T06:00', note: '  ' }, ids[12]); expect(value).toEqual(command('window').payload); expect(value).not.toHaveProperty('quantity');
  for (const scheduled_before of ['', '2030-02-30T06:00', '2030-05-18T06:00', '2030-06-19T06:00']) expect(() => commandPayload('window', detail(), context(), { scheduled_before }, ids[12])).toThrow();
  expect(() => commandPayload('window', detail({ summary: header({ kind: 'prn' }) }), context(), { scheduled_before: '2030-05-19T06:00' }, ids[12])).toThrow();
  expect(() => commandPayload('window', detail(), context(), { scheduled_before: '2030-05-26T06:00' }, ids[12])).toThrow('latest allowed');
});
it('shows captured nonzero seconds and microseconds rather than a different apparent boundary', () => {
  expect(utcTime('2030-05-18T06:00:30.123456Z')).toBe('2030-05-18 06:00:30.123456 UTC'); expect(utcTime('2030-05-18T06:00:00.000+00:00')).toBe('2030-05-18 06:00 UTC'); expect(instant('2030-02-30T06:00:00Z')).toBe(false);
});
it('keeps absent physical evidence and days unknown instead of arithmetic estimates', () => {
  const value = counts({ issued_stock_quantity: null, issued_stock_unit: null, issued_stock_unrecorded_doses: 1, stock_total_unavailable_reason: 'missing_evidence' }); expect(courseCounts(value)).toBe(value);
  expect(() => courseCounts({ ...value, issued_stock_quantity: 2, issued_stock_unit: 'tablet' })).toThrow(); expect(() => courseCounts(counts({ days_of_supply: 2 }))).toThrow(); expect(() => courseCounts(counts({ supplied_doses: Number.MAX_SAFE_INTEGER + 1 }))).toThrow();
});
it('binds current reads to the exact case/course and accepts controlled network review-only state', () => {
  expect(contextEvidence(context({ can_manage_courses: false, management_unavailable_reason: 'network_write_unavailable' }), scope).can_manage_courses).toBe(false);
  expect(() => contextEvidence(context({ admission_case_id: ids[20] }), scope)).toThrow(); expect(() => courseDetail(detail(), { ...scope, caseId: ids[20] }, scope.courseId)).toThrow();
  expect(courseDetail(detail({ summary: header({ generation_window_end: '2029-01-01T00:00:00Z' }), can_request_schedule_window: false, window_unavailable_reason: 'generation_boundary_unavailable' }), scope, scope.courseId)).toBeTruthy();
});
it('rejects repeated/duplicate pages and keeps original membership separate from current status', () => {
  expect(() => coursePage({ data: [], page: { has_next: true, next_cursor: 'same' } }, () => {}, { cursor: 'same' })).toThrow(); expect(() => coursePage({ data: [header(), header()], page: { has_next: false, next_cursor: null } }, () => {})).toThrow();
  const value = dose({ status: 'held', local_stop_id: ids[13], original_request_membership: { medication_administration_id: ids[9], scheduled_at: dose().scheduled_at, dose_sequence: 1, pharmacy_fulfillment_id: ids[10], status_at_command: 'scheduled', was_dispensed: false, scheduled_stock_policy: detail().scheduled_stock_policy } }); expect(courseDose(value).original_request_membership.status_at_command).toBe('scheduled'); expect(courseDose(value).status).toBe('held');
});
describe('immutable admission-course receipts', () => {
  it.each(['stop', 'window'])('accepts exact %s intent and canonical UTC precision without losing microseconds', (kind) => {
    const original = command(kind); const saved = receipt(original); if (kind === 'window') { saved.reviewed_input.scheduled_before = '2030-05-19T06:00:00.000+00:00'; } expect(courseReceipt(saved, original)).toBe(saved);
    expect(sameInstant('2030-05-17T06:00:00.123456Z', '2030-05-17T06:00:00.123457Z')).toBe(false);
  });
  it.each(['actor', 'case', 'ward-label', 'reason', 'token', 'uuid'])('rejects mismatched %s stop evidence', (fault) => {
    const original = command(); const saved = receipt(original); if (fault === 'actor') saved.recorded_by_user_id = ids[20]; if (fault === 'case') saved.admission_case_id = ids[20]; if (fault === 'ward-label') saved.result.ward_name = 'Different synthetic ward'; if (fault === 'reason') saved.result.reason = 'Different reason'; if (fault === 'token') saved.reviewed_input.expected_source_token = 'e'.repeat(64); if (fault === 'uuid') saved.client_request_id = ids[20]; expect(() => courseReceipt(saved, original)).toThrow(); expect(original.actorId).toBe(actorId); expect(original.caseId).toBe(caseId);
  });
  it.each(['count', 'duplicate-id', 'duplicate-time', 'wrong-unit', 'out-of-window'])('rejects malformed %s window membership', (fault) => {
    const original = command('window'); const saved = receipt(original); if (fault === 'count') saved.result.created_dose_count = 3; if (fault === 'duplicate-id') saved.result.created_doses[1].id = saved.result.created_doses[0].id; if (fault === 'duplicate-time') saved.result.created_doses[1].scheduled_at = saved.result.created_doses[0].scheduled_at; if (fault === 'wrong-unit') saved.result.created_doses[1].scheduled_stock_policy.stock_unit = 'pack'; if (fault === 'out-of-window') saved.result.created_doses[1].scheduled_at = original.payload.scheduled_before; expect(() => courseReceipt(saved, original)).toThrow();
  });
});
