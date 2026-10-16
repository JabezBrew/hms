import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import RustWardRoundWorkspace from '../RustWardRoundWorkspace';
import { ids, actor, patientId, admissionId, permissions, workspace, receipt } from './command-fixtures';
const originalRuntime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
const decision = { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let client, source, writes, saved, lose, malformed, denied, finishRead, slowRead, finishWrite, slowWrite, readStatus, sourceDenied, serverPermissions;
const onCommitted = vi.fn();
function Harness({ selectedPatient = patientId, selectedAdmission = admissionId, user = actor, readonly = false, candidates = [] }) {
  return <AuthContext.Provider value={{ user }}><QueryClientProvider client={client}><ReadOnlyModeProvider network={{ confirmed: true, decision: { ...decision, read_only: readonly } }}><RustWardRoundWorkspace patientId={selectedPatient} patient={{ id: selectedPatient, name: 'Synthetic round patient', patient_code: 'SYNTHETIC-ROUND' }} admission={selectedAdmission ? { id: selectedAdmission } : null} medications={candidates} onCommitted={onCommitted} /></ReadOnlyModeProvider></QueryClientProvider></AuthContext.Provider>;
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(actor), principal: { id: actor.id, facility_id: ids[1], active_profile: 'hospital' } }).update({ confirmed: true, decision });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60000 }, mutations: { retry: 3 } } }); source = null; writes = []; saved = new Map(); lose = false; malformed = false; denied = false; slowRead = false; slowWrite = false; readStatus = 200; sourceDenied = false; serverPermissions = { ...permissions }; onCommitted.mockClear();
  globalThis.fetch = vi.fn(async (url, options) => {
    const path = new URL(url).pathname;
    const targetPatient = path.split('/')[4];
    if (path.includes('/clinical/prescriptions/')) return json({ error: { code: 'patient_access_denied', message: 'Synthetic source denied' } }, sourceDenied ? 403 : 500);
    if (path.endsWith('/current')) {
      const selected = new URL(url).searchParams.get('admission_case_id');
      const response = () => readStatus !== 200 ? json({ error: { code: 'unavailable', message: 'Synthetic temporary failure' } }, readStatus) : denied ? json({ error: { code: 'patient_access_denied', message: 'Synthetic access denied' } }, 403) : json({ data: { ...workspace(source ? { ...source, permissions: { ...serverPermissions } } : null, targetPatient, selected), permissions: serverPermissions } });
      if (slowRead) return new Promise((resolve) => { finishRead = () => resolve(response()); });
      return response();
    }
    if (path.includes('/requests/')) { const value = saved.get(path.split('/').at(-1)); return value ? json({ data: { ...value, replayed: true } }) : json({ error: { code: 'not_found', message: 'Synthetic no receipt' } }, 404); }
    if (options.method === 'POST') {
      const wire = JSON.parse(options.body); writes.push({ path, wire });
      const perform = () => {
        const previous = saved.get(wire.client_request_id);
        if (previous) return json({ data: { ...previous, replayed: true } });
        const value = receipt(wire, path.endsWith('/commit') ? 'commit' : 'draft', source, targetPatient, wire.admission_case_id || admissionId);
        source = value.operation === 'committed' ? null : value.ward_round; saved.set(wire.client_request_id, value);
        if (lose) { lose = false; throw new TypeError('Synthetic saved response lost'); }
        return json({ data: malformed ? { ...value, ward_round: { ...value.ward_round, patient_id: ids[11] } } : value });
      };
      if (slowWrite) return new Promise((resolve, reject) => { finishWrite = () => { try { resolve(perform()); } catch (error) { reject(error); } }; });
      return perform();
    }
    throw new Error('Unexpected synthetic round request');
  });
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = originalRuntime; globalThis.fetch = originalFetch; });
async function reviewAndSave() { fireEvent.change(await screen.findByLabelText('Clinical narrative'), { target: { value: 'Synthetic reviewed round narrative' } }); fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed/ })); fireEvent.click(screen.getByRole('button', { name: 'Save reviewed draft' })); }
it('requires explicit review, saves one atomic snapshot, then completes only its fresh saved version', async () => {
  render(<Harness />); await screen.findByLabelText('Clinical narrative'); expect(screen.getByRole('button', { name: 'Save reviewed draft' })).toBeDisabled();
  await reviewAndSave(); await screen.findByText('Draft saved'); expect(writes).toHaveLength(1); expect(writes[0].path.endsWith('/ward-rounds/draft')).toBe(true); expect(writes[0].wire).toMatchObject({ admission_case_id: admissionId, ward_round_id: null, expected_version: 0, rendered_note: 'Synthetic reviewed round narrative', actions: [] });
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /I reviewed/ })).not.toBeChecked()); fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Complete reviewed round' })); await screen.findByText('Round completed'); expect(writes).toHaveLength(2); expect(writes[1].path.endsWith('/commit')).toBe(true); expect(writes[1].wire.expected_version).toBe(1); expect(onCommitted).toHaveBeenCalledTimes(1);
});
it('freezes an unknown save and explicitly retries the exact same UUID/body without global retries', async () => {
  lose = true; render(<Harness />); await reviewAndSave(); await screen.findByText('Save status unknown'); expect(writes).toHaveLength(1); expect(screen.getByLabelText('Clinical narrative')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry exact reviewed request' })); await screen.findByText('Draft saved'); expect(writes).toHaveLength(2); expect(writes[1].wire).toEqual(writes[0].wire); expect(saved.size).toBe(1);
});
it('recovers a saved result and keeps its immutable command when the original response is malformed', async () => {
  malformed = true; render(<Harness />); await reviewAndSave(); await screen.findByText('Save status unknown'); expect(writes).toHaveLength(1); malformed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Check original saved result' })); await screen.findByText('Draft saved'); expect(writes).toHaveLength(1); expect(screen.getByLabelText('Clinical narrative')).toHaveValue('Synthetic reviewed round narrative');
});
it('blocks duplicate writes and editing while an actual request is pending', async () => {
  slowWrite = true; render(<Harness />); await reviewAndSave(); await waitFor(() => expect(writes).toHaveLength(1)); expect(screen.getByLabelText('Clinical narrative')).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Save reviewed draft' })); expect(writes).toHaveLength(1);
  await act(async () => finishWrite()); await screen.findByText('Draft saved'); expect(writes).toHaveLength(1);
});
it('binds selected admission and removes copied narrative on a patient/admission change without late publication', async () => {
  slowWrite = true; const view = render(<Harness />); await reviewAndSave(); await waitFor(() => expect(writes).toHaveLength(1)); const finishOld = finishWrite;
  view.rerender(<Harness selectedPatient={ids[10]} selectedAdmission={ids[11]} />); expect(await screen.findByLabelText('Clinical narrative')).toHaveValue(''); await act(async () => finishOld()); expect(screen.queryByText('Draft saved')).not.toBeInTheDocument(); expect(onCommitted).not.toHaveBeenCalled(); expect(screen.getByLabelText('Clinical narrative')).toHaveValue('');
});
it('does not infer active admission from all history or allow a Summary narrative panel', async () => {
  const view = render(<Harness selectedAdmission={null} />); expect(screen.getByText('Select an admission')).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  view.rerender(<Harness user={{ ...actor, accessContext: { ...actor.accessContext, patient_visibility: ['clinical_summary'] } }} />); expect(screen.getByText(/full clinical access/)).toBeInTheDocument(); expect(screen.queryByLabelText('Clinical narrative')).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
it('remains read-only on the actual network boundary even with fresh writable server permissions', async () => {
  render(<Harness readonly />); await screen.findByLabelText('Clinical narrative'); expect(screen.getByLabelText('Clinical narrative')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Save reviewed draft' })).toBeDisabled(); expect(writes).toHaveLength(0);
});
it('never mounts a primed cached narrative before its new protected read, including delayed denial', async () => {
  render(<Harness />); await reviewAndSave(); await screen.findByText('Draft saved'); cleanup(); expect(client.getQueryCache().getAll().some((query) => query.state.data?.ward_round?.rendered_note === 'Synthetic reviewed round narrative')).toBe(true); slowRead = true; denied = true;
  render(<Harness />); expect(screen.queryByLabelText('Clinical narrative')).not.toBeInTheDocument(); await waitFor(() => expect(finishRead).toBeTypeOf('function')); await act(async () => finishRead()); await screen.findByText('Round workspace unavailable'); expect(screen.queryByDisplayValue('Synthetic reviewed round narrative')).not.toBeInTheDocument(); expect(writes).toHaveLength(1);
});

it('hides copied clinical content after a protected prescription-source denial until an explicit current read', async () => {
  sourceDenied = true; render(<Harness candidates={[{ id: ids[9], medication_name: 'Synthetic protected source' }]} />);
  fireEvent.change(await screen.findByLabelText('Clinical narrative'), { target: { value: 'Synthetic copied note before denial' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review Synthetic protected source' })); await screen.findByText('Round workspace unavailable'); expect(screen.queryByLabelText('Clinical narrative')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace' })); expect(await screen.findByLabelText('Clinical narrative')).toHaveValue('');
});
it('retains an unsaved draft through a temporary failed refresh while hiding its clinical DOM', async () => {
  render(<Harness />); fireEvent.change(await screen.findByLabelText('Clinical narrative'), { target: { value: 'Synthetic unsaved preserved draft' } });
  readStatus = 503; fireEvent.click(screen.getByRole('button', { name: 'Refresh saved evidence' })); await screen.findByText('Round workspace unavailable'); expect(screen.queryByLabelText('Clinical narrative')).not.toBeInTheDocument();
  readStatus = 200; fireEvent.click(screen.getByRole('button', { name: 'Refresh workspace' })); expect(await screen.findByLabelText('Clinical narrative')).toHaveValue('Synthetic unsaved preserved draft'); expect(writes).toHaveLength(0);
});
it('makes a retained unavailable laboratory action visible and requires explicit removal before saving', async () => {
  const wire = { client_request_id: ids[8], expected_version: 0, note_sections: { interval_history: null, examination: null, assessment: null, plan: null, clinical_readiness_blockers: [] }, rendered_note: 'Synthetic existing shared draft', actions: [{ action_type: 'lab_order', payload: { test_ids: [ids[10]], panel_ids: [], priority: 'routine' } }] };
  source = receipt(wire).ward_round; source.actions[0].reviewed_targets = [{ resource_type: 'lab_test', resource_id: ids[10], display_name: 'Synthetic named laboratory test', code: 'SYNTHETIC-TEST', selected: true, prescription: null }]; serverPermissions.can_order_labs = false;
  render(<Harness />); await screen.findByText('Laboratory selections need current permission'); expect(screen.getByText('Synthetic named laboratory test')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save reviewed draft' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove saved laboratory selections from this draft' })); fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed/ })); fireEvent.click(screen.getByRole('button', { name: 'Save reviewed draft' })); await screen.findByText('Draft saved'); expect(writes[0].wire.actions).toEqual([]);
});

it('keeps an unconfirmed completion locked when the real response omits its queued task result', async () => {
  const wire = { client_request_id: ids[8], expected_version: 0, note_sections: { interval_history: null, examination: null, assessment: null, plan: null, clinical_readiness_blockers: [] }, rendered_note: 'Synthetic saved task round', actions: [{ action_type: 'nursing_task', payload: { title: 'Synthetic queued task', instruction: 'Synthetic task instructions', due_at: '2026-10-16T05:00:00Z', task_type: 'ward_round', assigned_to_user_id: null } }] };
  source = receipt(wire).ward_round;
  render(<Harness />); await screen.findByLabelText('Clinical narrative'); fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed/ })); fireEvent.click(screen.getByRole('button', { name: 'Complete reviewed round' }));
  await screen.findByText('Save status unknown'); expect(onCommitted).not.toHaveBeenCalled(); expect(writes).toHaveLength(1); expect(screen.getByLabelText('Clinical narrative')).toBeDisabled();
});

it('shows preserved structured readiness evidence even when the legacy scalar sections are empty', async () => {
  source = receipt({ client_request_id: ids[8], expected_version: 0, note_sections: { interval_history: null, examination: null, assessment: null, plan: null, clinical_readiness_blockers: ['Synthetic earlier readiness evidence'] }, rendered_note: null, actions: [] }).ward_round;
  render(<Harness />); await screen.findByLabelText('Clinical narrative'); expect(screen.getByText('Synthetic earlier readiness evidence')).toBeInTheDocument(); expect(writes).toHaveLength(0);
});
