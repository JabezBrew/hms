import { expect, it } from 'vitest';
import { responseCommand, responseContext, responseHistoryItem, responsePage, responseReceipt, responseRevision, historyQuery } from '../model';
import { responseKeys } from '../keys';
import { actorId, at, context, laterId, metadata, patientId, receipt, referralId, requestId, revision, revisionId, scope } from './fixtures';
const command = (overrides = {}) => responseCommand({ scope, source: context, operation: 'save_draft', specialistNotes: revision.specialist_notes, recommendations: revision.recommendations, amendmentReason: '', requestId, actorId, ...overrides });
it('represents absence and separates recorded status from a later scheduled root', () => {
  expect(responseContext(context, scope).response).toBeNull();
  expect(responseContext({ ...context, status: 'scheduled', version: 1, response: revision }, scope).response.status).toBe('accepted');
});
it('retains unknown imported content and provenance without inventing authors or completion', () => {
  const legacy = { ...revision, operation: 'legacy_observed', imported_legacy: true, specialist_notes: null, recommendations: null, recorded_by_user_id: null, recorded_by_display_name: null, status: 'completed', completed_at: null };
  expect(responseRevision(legacy, scope)).toBe(legacy);
});
it.each(['patient', 'referral', 'token', 'version', 'response', 'capability', 'status', 'service', 'priority'])('rejects malformed current %s evidence', fault => {
  const value = structuredClone(context);
  if (fault === 'patient') value.patient_id = laterId;
  if (fault === 'referral') value.referral_id = laterId;
  if (fault === 'token') value.context_token = 'guessed';
  if (fault === 'version') value.version = -1;
  if (fault === 'response') value.response = revision;
  if (fault === 'capability') delete value.can_complete;
  if (fault === 'status') value.status = 'completed';
  if (fault === 'service') value.to_service = '';
  if (fault === 'priority') value.priority = 'inferred';
  expect(() => responseContext(value, scope)).toThrow(/could not be confirmed/);
});
it('pins exact context and input bytes while saving a draft without completing', () => {
  expect(command()).toMatchObject({ ...scope, actorId, source: context, payload: { client_request_id: requestId, expected_version: 0, expected_context_token: context.context_token, operation: 'save_draft', specialist_notes: revision.specialist_notes, recommendations: revision.recommendations, amendment_reason: null } });
  expect(responseReceipt(receipt, command()).response.status).toBe('accepted');
});
it.each(['notes-short', 'notes-long', 'recommendations-long', 'capability', 'request', 'actor', 'operation', 'unexpected-reason'])('refuses unsupported %s before dispatch', fault => {
  const override = {};
  if (fault === 'notes-short') override.specialistNotes = '  short  ';
  if (fault === 'notes-long') override.specialistNotes = 'x'.repeat(20001);
  if (fault === 'recommendations-long') override.recommendations = 'x'.repeat(10001);
  if (fault === 'capability') override.source = { ...context, can_save_draft: false };
  if (fault === 'request') override.requestId = 'missing';
  if (fault === 'actor') override.actorId = null;
  if (fault === 'operation') override.operation = 'complete_automatically';
  if (fault === 'unexpected-reason') override.amendmentReason = 'Do not silently discard this';
  expect(() => command(override)).toThrow();
});
it('requires an explicit amendment reason and preserves the original completion date', () => {
  const source = { ...context, status: 'completed', completed_at: at, version: 1, response: { ...revision, operation: 'completed', status: 'completed', completed_at: at }, can_save_draft: false, can_complete: false, can_amend: true };
  expect(() => command({ source, operation: 'amend', amendmentReason: '' })).toThrow(/reason/);
  const amended = command({ source, operation: 'amend', amendmentReason: '  Synthetic explicit correction  ' });
  expect(amended.payload.amendment_reason).toBe('Synthetic explicit correction');
  const saved = { ...receipt, operation: 'amended', response: { ...revision, id: laterId, version: 2, operation: 'amended', status: 'completed', completed_at: at, amendment_reason: amended.payload.amendment_reason } };
  expect(responseReceipt(saved, amended)).toBe(saved);
  expect(() => responseReceipt({ ...saved, response: { ...saved.response, completed_at: '2026-10-18T09:00:00Z' } }, amended)).toThrow();
});
it('completes only through a distinct reviewed command with an actual terminal time', () => {
  const complete = command({ operation: 'complete' });
  expect(responseReceipt({ ...receipt, operation: 'completed', response: { ...revision, operation: 'completed', status: 'completed', completed_at: at } }, complete).response.completed_at).toBe(at);
});
it.each(['patient', 'referral', 'uuid', 'version', 'operation', 'notes', 'recommendations', 'reason', 'actor', 'time', 'service', 'priority', 'capability', 'completion'])('refuses wrong-but-valid %s receipt evidence', fault => {
  const value = structuredClone(receipt);
  if (fault === 'patient') value.response.patient_id = laterId;
  if (fault === 'referral') value.response.referral_id = laterId;
  if (fault === 'uuid') value.client_request_id = laterId;
  if (fault === 'version') value.response.version = 2;
  if (fault === 'operation') value.operation = 'completed';
  if (fault === 'notes') value.response.specialist_notes = 'Different complete synthetic notes';
  if (fault === 'recommendations') value.response.recommendations = '';
  if (fault === 'reason') value.response.amendment_reason = 'Unexpected';
  if (fault === 'actor') value.response.recorded_by_user_id = laterId;
  if (fault === 'time') value.recorded_at = '2026-10-18T09:00:00Z';
  if (fault === 'service') value.response.to_service = 'Different selected service';
  if (fault === 'priority') value.response.priority = 'urgent';
  if (fault === 'capability') value.can_complete = true;
  if (fault === 'completion') value.response.completed_at = at;
  expect(() => responseReceipt(value, command())).toThrow();
});
it('reads bounded lean history and exact versions without body fallback', () => {
  const row = metadata(); const page = { data: [row], page: { limit: 1, has_next: false, next_cursor: null } };
  expect(responsePage(page, scope, { limit: 1 }).rows).toEqual([row]);
  expect(responseRevision(revision, scope, revisionId)).toBe(revision);
  expect(() => responseRevision(revision, scope, laterId)).toThrow();
  expect(() => responsePage({ ...page, data: [revision] }, scope, { limit: 1 })).toThrow();
  expect(() => responsePage({ ...page, data: [row, row] }, scope, { limit: 2 })).toThrow();
  expect(() => responseHistoryItem({ ...row, recorded_by_user_id: null }, scope)).toThrow();
});
it('keeps paging server-owned and rejects fake cursors or unsupported limits', () => {
  expect(historyQuery()).toEqual({ limit: 25, cursor: undefined });
  expect(historyQuery({ limit: 100, cursor: 'v:101' })).toEqual({ limit: 100, cursor: 'v:101' });
  for (const query of [{ limit: 101 }, { limit: 0 }, { cursor: 'first-page' }, { cursor: 'v:0' }]) expect(() => historyQuery(query)).toThrow();
});
it('sanitizes patient referral and authority keys without copied clinical text', () => {
  const key = responseKeys.context('opaque-authority', patientId, referralId);
  expect(JSON.stringify(key)).not.toContain(patientId); expect(JSON.stringify(key)).not.toContain(referralId); expect(JSON.stringify(key)).not.toContain(revision.specialist_notes);
  expect(responseKeys.context('changed-authority', patientId, referralId)).not.toEqual(key);
});
