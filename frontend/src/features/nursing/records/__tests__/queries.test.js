import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient } from '@/lib/api/v2/client';
import { getV2NursingTasks, getV2PatientVitals } from '@/hooks/nursingQueriesV2Bridge';
import { nursingRecordsCacheScope } from '../queries';

const originalFetch = globalThis.fetch;
const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const task = (id, extra = {}) => ({ id, patient_id: 'synthetic-patient', admission_case_id: 'synthetic-admission', ward_id: 'synthetic-ward', service_ward_id: 'synthetic-ward', route_version: 0, task_type: 'observation', status: 'open', due_at: '2026-10-31T12:00:00Z', ...extra });
const vital = (id, extra = {}) => ({ id, patient_id: 'synthetic-patient', admission_case_id: 'synthetic-admission', recorded_at: '2020-01-01T12:00:00Z', pulse: 80, ...extra });
const page = (data, cursor = null) => new Response(JSON.stringify({ data, page: { has_next: Boolean(cursor), next_cursor: cursor } }), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS' }); globalThis.fetch = vi.fn();
});
afterEach(() => { __resetV2ApiClientForTests(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; });

it('sends task patient, admission, effective service ward, type, state and UTC day filters before following cursors', async () => {
  fetch.mockResolvedValueOnce(page([task('first')], 'next')).mockResolvedValueOnce(page([task('second')]));
  const rows = await getV2NursingTasks({ patient: 'synthetic-patient', admission: 'synthetic-admission', ward: 'synthetic-ward', status: 'pending', task_type: 'observation', date: '2026-10-31', limit: 1 });
  expect(rows.map((row) => row.id)).toEqual(['first', 'second']);
  for (const [url] of fetch.mock.calls) {
    const query = new URL(url).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({ patient_id: 'synthetic-patient', admission_case_id: 'synthetic-admission', ward_id: 'synthetic-ward', status: 'open', task_type: 'observation', due_from: '2026-10-31T00:00:00.000Z', due_before: '2026-11-01T00:00:00.000Z' });
  }
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('next');
});

it('rejects an out-of-scope task page instead of quietly dropping its rows', async () => {
  fetch.mockResolvedValueOnce(page([task('wrong', { patient_id: 'other-patient' })]));
  await expect(getV2NursingTasks({ patient: 'synthetic-patient' })).rejects.toThrow(/scope could not be confirmed/);
});

it('keeps all-history scalar observations across pages without inventing a seven-day cut-off', async () => {
  fetch.mockResolvedValueOnce(page([vital('old')], 'next')).mockResolvedValueOnce(page([vital('older', { recorded_at: '2019-01-01T00:00:00Z' })]));
  const rows = await getV2PatientVitals({ patient: 'synthetic-patient', descending: true, limit: 1 });
  expect(rows).toHaveLength(2);
  expect(new URL(fetch.mock.calls[0][0]).searchParams.has('hours')).toBe(false);
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('next');
});

it('preserves explicit scalar time and current admission scope without a visit-wide fallback', async () => {
  fetch.mockResolvedValueOnce(page([vital('recent', { recorded_at: '2026-10-31T23:59:59Z' })]));
  await getV2PatientVitals({ patient: 'synthetic-patient', admission_case_id: 'synthetic-admission', encounter_id: 'synthetic-visit', date: '2026-10-31', days: 2 });
  const query = new URL(fetch.mock.calls[0][0]).searchParams;
  expect(query.get('recorded_before')).toBe('2026-11-01T00:00:00.000Z'); expect(query.get('hours')).toBe('48');
  await expect(getV2PatientVitals({ patient: 'synthetic-patient', encounter_id: 'synthetic-visit' })).rejects.toThrow(/Visit-scoped/);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not return a partial chart when the next page aborts', async () => {
  const controller = new AbortController();
  fetch.mockResolvedValueOnce(page([vital('first')], 'next')).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
  await expect(getV2PatientVitals({ patient: 'synthetic-patient' }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch.mock.calls.every(([, options]) => options.signal === controller.signal)).toBe(true);
});

it.each(['missing', 'repeated'])('fails a %s cursor without reporting a complete history', async (kind) => {
  fetch.mockResolvedValueOnce(page([vital('first')], 'next'));
  if (kind === 'repeated') fetch.mockResolvedValueOnce(page([vital('second')], 'next'));
  else fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [vital('second')], page: { has_next: true } }), { status: 200 }));
  await expect(getV2PatientVitals({ patient: 'synthetic-patient' })).rejects.toThrow(/nursing record window/);
});

it('fails an oversized window at its explicit bound without returning partial records', async () => {
  let count = 0; fetch.mockImplementation(() => Promise.resolve(page([vital(String(++count))], `cursor-${count}`)));
  await expect(getV2PatientVitals({ patient: 'synthetic-patient', limit: 1 })).rejects.toThrow(/shorter time range/);
  expect(fetch).toHaveBeenCalledTimes(100);
});

it('separates hour, direction, ward and admission aliases in opaque cache scope', () => {
  const base = { patient: 'synthetic-patient', hours: 48, ordering: '-recorded_at' };
  const key = nursingRecordsCacheScope('vitals', base);
  expect(key).not.toContain('synthetic-patient');
  for (const change of [{ hours: 1 }, { ordering: 'recorded_at' }, { ward_id: 'other-ward' }, { admission_case_id: 'other-admission' }]) expect(nursingRecordsCacheScope('vitals', { ...base, ...change })).not.toBe(key);
});

it('rejects unsupported priority and invalid dates before issuing a request', async () => {
  await expect(getV2NursingTasks({ priority: 'high' })).rejects.toThrow(/not available/);
  await expect(getV2PatientVitals({ date: '2026-02-30' })).rejects.toThrow(/UTC date/);
  expect(fetch).not.toHaveBeenCalled();
});
