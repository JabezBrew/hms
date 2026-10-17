import { expect, it } from 'vitest';
import { advisoryPayload, draftIsStale } from '../model';
import { advisoryContext, advisoryDetail, advisoryReceipt } from '../contracts';
import { ids, patientId, caseId, command, receipt, context, detail, retired } from './fixtures';
it('requires an explicitly selected available type and note, without blocker or role fields', () => {
  const draft = { kind: 'create', requestId: ids[9], context: context(), taskType: '', notes: '' };
  expect(() => advisoryPayload(draft)).toThrow('Choose an available'); draft.taskType = 'registration_completion'; expect(() => advisoryPayload(draft)).toThrow('Choose an available'); draft.taskType = 'transport'; draft.notes = '  Synthetic note  ';
  expect(advisoryPayload(draft)).toEqual({ client_request_id: ids[9], expected_context_token: 'a'.repeat(64), task_type: 'transport', notes: 'Synthetic note' });
});
it.each(['acknowledged_unresolved', 'cancelled'])('requires an explicit reason for %s', (decision) => {
  expect(() => advisoryPayload({ kind: 'decision', requestId: ids[9], context: context(), source: detail(), decision, reason: '' })).toThrow('required');
});
it('allows completion with no note, while preserving the explicit reviewed decision', () => {
  const value = advisoryPayload({ kind: 'decision', requestId: ids[9], context: context(), source: detail(), decision: 'completed', reason: '' }); expect(value.reason).toBeNull(); expect(value.decision).toBe('completed');
});
it('rejects incomplete metadata totals, wrong-valid scope and fabricated terminal capabilities', () => {
  expect(() => advisoryContext(context({ complete: false }), { patientId, caseId })).toThrow(); expect(() => advisoryContext(context({ patient_id: ids[20] }), { patientId, caseId })).toThrow(); expect(() => advisoryContext(context({ counts_by_status: {} }), { patientId, caseId })).toThrow();
  const value = retired(); expect(advisoryDetail(value, { patientId, caseId })).toBe(value); expect(() => advisoryDetail({ ...value, can_complete: true }, { patientId, caseId })).toThrow();
});
it('validates immutable source, actor, notes, decision and manual versus automatic evidence', () => {
  for (const kind of ['create', 'decision']) { const input = command(kind); const value = receipt(input); expect(advisoryReceipt(value, input)).toBe(value); expect(() => advisoryReceipt({ ...value, advisory: { ...value.advisory, notes: 'Different synthetic note' } }, input)).toThrow(); }
  const input = command('decision', 'cancelled'); const value = receipt(input); value.advisory.decision.source = 'admission_case_cancelled'; value.advisory.decision.system_reason_code = 'admission_case_cancelled'; expect(() => advisoryReceipt(value, input)).toThrow();
});
it('marks changed current context or task version stale without rewriting a copied review', () => {
  const input = command('decision'); const draft = { ...input, requestId: ids[9] }; expect(draftIsStale(draft, input.context)).toBe(false); expect(draftIsStale(draft, { ...input.context, context_token: 'b'.repeat(64) })).toBe(true); expect(draft.context.context_token).toBe('a'.repeat(64));
});

it.each([
  ['create', 'captured_ward_name'], ['decision', 'captured_ward_name'], ['decision', 'created_by_display_name'], ['decision', 'decision_ward_name'],
])('rejects a corrupted %s receipt label %s', (kind, field) => {
  const input = command(kind); const value = receipt(input); if (field === 'decision_ward_name') value.advisory.decision.ward_name = 'Different synthetic ward'; else value.advisory[field] = 'Different synthetic captured label'; expect(() => advisoryReceipt(value, input)).toThrow();
});
it('does not permit free text to masquerade as an automatic episode retirement reason', () => {
  const value = retired(); value.decision.reason = 'Synthetic invented clinical explanation'; expect(() => advisoryDetail(value, { patientId, caseId })).toThrow();
});
it('requires rows and available types together to account for all eight known types', () => {
  expect(() => advisoryContext(context({ available_types: ['transport'] }), { patientId, caseId })).toThrow();
});

it('requires captured actor labels from the typed evidence instead of inventing missing provenance', () => { const value = detail({ created_by_display_name: null }); expect(() => advisoryDetail(value, { patientId, caseId })).toThrow(); });
