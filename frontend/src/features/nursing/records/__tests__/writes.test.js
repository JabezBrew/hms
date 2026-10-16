import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey, v2Api } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteReview, activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { decideNursingTask, recordNursingTask, recordPatientVitals } from '../api';
const ids = Array.from({ length: 8 }, (_, i) => `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`);
const principal = { id: ids[0], facility_id: ids[1], active_profile: 'hospital' };
const observed = { admission_case_id: ids[2], recorded_at: '2026-10-16T04:00:00Z', temperature_c: 37.6, systolic_bp: null, diastolic_bp: null, pulse: 80, respiratory_rate: null, oxygen_saturation: null };
const taskPayload = { admission_case_id: ids[2], task_type: 'observation', due_at: observed.recorded_at, title: 'Synthetic protected task title', instruction: 'Synthetic protected task instruction', assigned_to_user_id: ids[0] };
const common = { id: ids[4], patient_id: ids[3], admission_case_id: ids[2], ward_id: ids[5] };
const decision = (status) => ({ ...common, status, completed_at: status === 'completed' ? observed.recorded_at : null, completed_by_user_id: status === 'completed' ? ids[0] : null, cancelled_at: status === 'cancelled' ? observed.recorded_at : null, cancelled_by_user_id: status === 'cancelled' ? ids[0] : null });
const scenarios = [
  { name: 'vitals', run: () => recordPatientVitals(observed, { patientId: ids[3] }), row: { ...common, ...observed, temperature_c: 37.599998474121094 }, read: () => v2Api.getPatientVitals({ query: { patient_id: ids[3], admission_case_id: ids[2] } }) },
  { name: 'task creation', run: () => recordNursingTask(taskPayload, { patientId: ids[3] }), row: { ...common, ...taskPayload, status: 'open' }, read: () => v2Api.getNursingTasks({ query: { patient_id: ids[3], admission_case_id: ids[2] } }) },
  ...['completed', 'cancelled'].map((status) => ({ name: status, run: () => decideNursingTask(ids[4], status), row: decision(status), read: () => v2Api.getNursingTasks({ query: { patient_id: ids[3], admission_case_id: ids[2] } }) })),
];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const runtime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
function activate() {
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-nursing-authority', principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  activateWriteUncertainty(principal);
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); activate(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });

it.each(scenarios)('confirms a scoped $name receipt without inventing values', async ({ run, row }) => {
  fetch.mockResolvedValueOnce(json({ data: row })); await expect(run()).resolves.toEqual(row); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0); expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(scenarios)('keeps a malformed $name result blocked across reload and requires explicit review after a related successful read', async ({ run, row, read }) => {
  fetch.mockResolvedValueOnce(json({ data: { ...row, patient_id: '' } }));
  await expect(run()).rejects.toMatchObject({ name: 'NursingRecordUnconfirmedError' }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  for (const value of [...ids, taskPayload.title, taskPayload.instruction, 'SYNTHETIC-TOKEN']) expect(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).not.toContain(value);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate();
  await expect(run()).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(json({ data: [row], page: { has_next: false, next_cursor: null } })); await read();
  const entry = getWriteUncertaintySnapshot().entries[0]; expect(entry.reviewed).toBe(true);
  await expect(run()).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(2);
  await acknowledgeWriteReview(entry.id, principal); fetch.mockResolvedValueOnce(json({ data: row })); await expect(run()).resolves.toEqual(row);
});

it.each(['lost', 'generic409'])('retains an unresolved scalar observation after $name without a second POST', async (failure) => {
  if (failure === 'lost') fetch.mockRejectedValueOnce(new TypeError('Synthetic response loss'));
  else fetch.mockResolvedValueOnce(json({ error: { code: 'nursing_write_unconfirmed', message: 'Unconfirmed' } }, 409));
  await expect(scenarios[0].run()).rejects.toMatchObject({ name: 'NursingRecordUnconfirmedError' });
  await expect(scenarios[0].run()).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1);
});

it('treats a terminal conflict as a definite rejection and preserves unknown historical actors', async () => {
  fetch.mockResolvedValueOnce(json({ error: { code: 'nursing_decision_conflict' } }, 409));
  await expect(scenarios[2].run()).rejects.toMatchObject({ status: 409 }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  const row = { ...decision('completed'), completed_at: null, completed_by_user_id: null };
  fetch.mockResolvedValueOnce(json({ data: row })); await expect(scenarios[2].run()).resolves.toMatchObject({ completed_at: null, completed_by_user_id: null });
});

it.each(['completed', 'cancelled'].flatMap((status) => ['patient_id', 'admission_case_id'].map((field) => ({ status, field }))))('retains uncertainty for a wrong but valid $field in a $status receipt', async ({ status, field }) => {
  fetch.mockResolvedValueOnce(json({ data: { ...decision(status), [field]: ids[7] } }));
  await expect(decideNursingTask(ids[4], status, { patientId: ids[3], admissionId: ids[2] })).rejects.toMatchObject({ name: 'NursingRecordUnconfirmedError' }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
});
