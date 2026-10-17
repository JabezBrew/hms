import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
import AdmissionAdvisoryPanel from '../AdmissionAdvisoryPanel';
import { user, actorId, facilityId, patientId, caseId, otherCaseId, advisoryId, caseRow, context, detail, receipt, retired, json } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__; const oldFetch = globalThis.fetch;
const decision = { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 };
const clinicalPermissions = { can_view_full_clinical: true, can_add_note: false, can_record_vitals: false, can_prescribe: false };
const pointerNames = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'];
const pointerOriginals = new Map(pointerNames.map((key) => [key, Object.getOwnPropertyDescriptor(Element.prototype, key)]));
const onClose = vi.fn(); let client, rows, receipts, writes, requests, lose, malformed, slowWrite, finishWrite, contextStatus, failAfterSave, denyDetail, paged, caseStatus, contextToken;
function Harness({ open = true, selected = null, requested = caseId, history = false, actor = user, readonly = false, host = false, full = true, patient = patientId }) {
  const person = { id: patient, name: 'Synthetic follow-up patient', local_data: { id: patient, medical_record_number: 'SYNTHETIC-ADVISORY-MRN', current_admission_id: otherCaseId } };
  const proof = { ...clinicalPermissions, can_view_full_clinical: full };
  return <AuthContext.Provider value={{ user: actor }}><QueryClientProvider client={client}><ReadOnlyModeProvider network={{ confirmed: true, decision: { ...decision, read_only: readonly } }}>{host ? <ChronicleWorkspaceHost activeWorkspace={open ? 'admissionAdvisory' : null} workspaceContext={{ patient: person, patientId: patient, selectedAdmissionId: selected, chronicleAllHistory: history, requestedAdvisoryCaseId: requested, clinicalPermissions: proof, onClose }} /> : <AdmissionAdvisoryPanel {...{ open, onClose }} patient={person} requestedCaseId={requested} selectedAdmissionId={selected} allHistory={history} clinicalPermissions={proof} />}</ReadOnlyModeProvider></QueryClientProvider></AuthContext.Provider>;
}
function currentContext(targetPatient, targetCase) {
  const selected = targetCase === otherCaseId ? caseRow({ patient_id: targetPatient, admission_case_id: targetCase, current_ward_name: 'Synthetic active ward', admission_status: 'admitted' }) : caseRow({ patient_id: targetPatient, admission_case_id: targetCase });
  return context({ ...selected, context_token: contextToken }, [...rows.values()].filter((row) => row.patient_id === targetPatient && row.admission_case_id === targetCase));
}
beforeEach(() => {
  for (const key of pointerNames) Object.defineProperty(Element.prototype, key, { configurable: true, value: key === 'hasPointerCapture' ? () => false : () => {} });
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal: { id: actorId, facility_id: facilityId, active_profile: 'hospital' } }).update({ confirmed: true, decision }); activateWriteUncertainty({ id: actorId, facility_id: facilityId, active_profile: 'hospital' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 3 } } }); rows = new Map(); receipts = new Map(); writes = []; requests = []; lose = false; malformed = false; slowWrite = false; contextStatus = 200; failAfterSave = false; denyDetail = false; paged = false; caseStatus = 200; contextToken = 'a'.repeat(64); onClose.mockClear();
  globalThis.fetch = vi.fn(async (input, options = {}) => {
    const url = new URL(input); const path = url.pathname; const parts = path.split('/').filter(Boolean); const targetPatient = parts[3]; const targetCase = parts[6]; requests.push({ url, options });
    if (path.endsWith('/admission-advisory-cases')) return caseStatus !== 200 ? json({ error: { code: 'synthetic_unavailable', message: 'Synthetic list failure' } }, caseStatus) : json({ data: (paged && url.searchParams.get('cursor') ? [caseRow({ admission_case_id: otherCaseId, current_ward_name: 'Synthetic active ward', admission_status: 'admitted' })] : paged ? [caseRow()] : [caseRow(), caseRow({ admission_case_id: otherCaseId, current_ward_name: 'Synthetic active ward', admission_status: 'admitted' })]).map((row) => ({ ...row, patient_id: targetPatient })), page: { has_next: paged && !url.searchParams.get('cursor'), next_cursor: paged && !url.searchParams.get('cursor') ? 'synthetic-page-two' : null } });
    if (path.includes('/requests/')) { const saved = receipts.get(parts.at(-1)); return saved ? json({ data: { ...saved, replayed: true } }) : json({ error: { code: 'not_found', message: 'Synthetic missing result' } }, 404); }
    if (options.method !== 'POST' && path.endsWith('/advisories')) return contextStatus === 200 ? json({ data: currentContext(targetPatient, targetCase) }) : json({ error: { code: 'synthetic_unavailable', message: 'Synthetic current context failure' } }, contextStatus);
    if (options.method === 'POST') {
      const payload = JSON.parse(options.body); writes.push({ path, payload });
      const perform = () => {
        const earlier = receipts.get(payload.client_request_id); if (earlier) return json({ data: { ...earlier, replayed: true } });
        const kind = path.endsWith('/decision') ? 'decision' : 'create'; const source = kind === 'decision' ? rows.get(parts.at(-2)) : null;
        const original = { kind, payload, source, patientId: targetPatient, caseId: targetCase, actorId, context: currentContext(targetPatient, targetCase) }; const saved = receipt(original);
        const current = { ...saved.advisory, can_complete: kind === 'create', can_acknowledge_unresolved: kind === 'create', can_cancel: kind === 'create' }; rows.set(current.id, current); receipts.set(payload.client_request_id, saved);
        if (failAfterSave) contextStatus = 503; if (lose) { lose = false; throw new TypeError('Synthetic saved response lost'); }
        return json({ data: malformed ? { ...saved, advisory: { ...saved.advisory, notes: 'Different synthetic receipt note' } } : saved });
      };
      if (slowWrite) return new Promise((resolve, reject) => { options.signal?.addEventListener('abort', () => reject(new DOMException('Synthetic dispatched abort', 'AbortError')), { once: true }); finishWrite = () => { try { resolve(perform()); } catch (error) { reject(error); } }; });
      return perform();
    }
    const value = rows.get(parts.at(-1)); return denyDetail ? json({ error: { code: 'patient_access_denied', message: 'Synthetic detail denied' } }, 403) : value ? json({ data: value }) : json({ error: { code: 'not_found', message: 'Synthetic no task' } }, 404);
  });
});
afterEach(() => { for (const key of pointerNames) { const old = pointerOriginals.get(key); if (old) Object.defineProperty(Element.prototype, key, old); else delete Element.prototype[key]; } cleanup(); client?.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = oldFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
async function draftCreate() {
  await userEvent.click(await screen.findByRole('button', { name: 'Add follow-up' })); await userEvent.click(screen.getByRole('combobox', { name: 'Follow-up type' })); await userEvent.click(screen.getByRole('option', { name: 'Transport' })); fireEvent.change(screen.getByLabelText('Follow-up note'), { target: { value: 'Synthetic private follow-up note' } }); fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed this patient/ }));
}
async function saveCreate() { await draftCreate(); fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed change' })); }
it('records an explicit reviewed Ready-case task without activating the stay or assuming a current admission', async () => {
  render(<Harness />); await draftCreate(); expect(screen.getByText(/Selected admission case · Ready for activation/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed change' })); await screen.findByText(/Follow-up change recorded/); expect(writes).toHaveLength(1); expect(writes[0].path).toContain(`/admissions/${caseId}/advisories`); expect(writes[0].payload).toMatchObject({ task_type: 'transport', notes: 'Synthetic private follow-up note', expected_context_token: 'a'.repeat(64) }); expect(writes[0].payload).not.toHaveProperty('assigned_role'); expect(screen.getByText(/SYNTHETIC-ADVISORY-MRN/)).toBeInTheDocument(); expect(screen.getByText(/Before admission activation/)).toBeInTheDocument();
});
it('allows a completion note to be empty and preserves completed versus unresolved decisions', async () => {
  rows.set(advisoryId, detail()); render(<Harness />); fireEvent.click(await screen.findByRole('button', { name: /Transport Pending/ })); fireEvent.click(await screen.findByRole('button', { name: 'Complete follow-up' })); expect(screen.getByLabelText('Completion note (optional)')).toHaveValue(''); fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed change' })); await screen.findByText(/Follow-up change recorded/); expect(writes[0].payload).toMatchObject({ decision: 'completed', reason: null, expected_version: 1 }); expect(screen.getByText('No completion note recorded.')).toBeInTheDocument();
});
it('requires a reason for acknowledgment and never labels it completed', async () => {
  rows.set(advisoryId, detail()); render(<Harness />); fireEvent.click(await screen.findByRole('button', { name: /Transport Pending/ })); fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge unresolved follow-up' })); fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed/ })); expect(screen.getByRole('button', { name: 'Confirm reviewed change' })).toBeDisabled(); fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: 'Synthetic outstanding transport' } }); expect(screen.getByRole('checkbox', { name: /I confirmed/ })).not.toBeChecked(); fireEvent.click(screen.getByRole('checkbox', { name: /I confirmed/ })); fireEvent.click(screen.getByRole('button', { name: 'Confirm reviewed change' })); await screen.findByText(/Follow-up change recorded/); expect(writes[0].payload.decision).toBe('acknowledged_unresolved'); expect(screen.getByText('Task decision: Acknowledged unresolved')).toBeInTheDocument();
});
it.each(['admission_case_cancelled', 'admission_discharged'])('shows persisted %s retirement actor/time without inventing clinical completion', async (source) => {
  rows.set(advisoryId, retired(source)); render(<Harness />); fireEvent.click(await screen.findByRole('button', { name: /Transport Cancelled/ })); await screen.findByText(/This pending task was retired with the episode/); expect(screen.getByText(/Synthetic closure actor/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Complete follow-up' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('keeps a lost-response command unchanged across real Host close/reopen and confirms its original result', async () => {
  lose = true; const view = render(<Harness host />); await saveCreate(); await screen.findByText('Save status unknown'); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); const wire = writes[0].payload;
  view.rerender(<Harness host open={false} />); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); const count = fetch.mock.calls.length; await act(async () => Promise.resolve()); expect(fetch).toHaveBeenCalledTimes(count);
  view.rerender(<Harness host />); await screen.findByText('Save status unknown'); fireEvent.click(screen.getByRole('button', { name: 'Check original saved result' })); await screen.findByText(/Follow-up change recorded/); expect(writes).toHaveLength(1); expect(writes[0].payload).toEqual(wire); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('freezes malformed success and permits only an explicit exact request replay', async () => {
  malformed = true; render(<Harness />); await saveCreate(); await screen.findByText('Save status unknown'); const first = writes[0].payload; malformed = false; fireEvent.click(screen.getByRole('button', { name: 'Retry exact reviewed request' })); await screen.findByText(/Follow-up change recorded/); expect(writes).toHaveLength(2); expect(writes[1].payload).toEqual(first);
});
it('prevents duplicate dispatch and all pending dismissal paths', async () => {
  slowWrite = true; render(<Harness />); await saveCreate(); await waitFor(() => expect(writes).toHaveLength(1)); fireEvent.keyDown(document, { key: 'Escape' }); fireEvent.click(screen.getAllByRole('button', { name: 'Close', exact: true })[0]); expect(onClose).not.toHaveBeenCalled(); expect(screen.getByLabelText('Follow-up note')).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Recording…' })); expect(writes).toHaveLength(1); await act(async () => finishWrite()); await screen.findByText(/Follow-up change recorded/);
});
it('preserves known success when a subsequent context refresh fails', async () => {
  failAfterSave = true; render(<Harness />); await saveCreate(); await screen.findByText(/The original follow-up change is confirmed/); expect(screen.queryByText('Synthetic private follow-up note')).not.toBeInTheDocument(); contextStatus = 200; fireEvent.click(screen.getByRole('button', { name: 'Refresh follow-up' })); await screen.findByText(/Follow-up change recorded/); expect(writes).toHaveLength(1);
});
it('does not infer a case from patient current admission in all-history scope', async () => {
  render(<Harness requested={null} history />); await screen.findByText(/No current admission is selected automatically/); expect(requests.filter((row) => row.url.pathname.endsWith('/advisories'))).toHaveLength(0); fireEvent.click(await screen.findByRole('button', { name: /Synthetic receiving ward · Ready for activation/ })); await screen.findByRole('button', { name: 'Add follow-up' }); expect(requests.find((row) => row.url.pathname.endsWith('/advisories')).url.pathname).toContain(caseId);
});
it('replaces copied draft on an explicit case change and never follows a different active case silently', async () => {
  const view = render(<Harness />); await draftCreate(); view.rerender(<Harness requested={otherCaseId} />); await screen.findByText(/Selected admission case · Admitted/); expect(screen.queryByDisplayValue('Synthetic private follow-up note')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('hides protected task evidence immediately after an authoritative detail denial', async () => {
  rows.set(advisoryId, detail()); render(<Harness />); fireEvent.click(await screen.findByRole('button', { name: /Transport Pending/ })); await screen.findByText('Synthetic private follow-up note'); denyDetail = true; fireEvent.click(screen.getByRole('button', { name: 'Refresh current evidence' })); await screen.findByText('Admission follow-up unavailable'); expect(screen.queryByText('Synthetic private follow-up note')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Complete follow-up' })).not.toBeInTheDocument();
});
it('removes copied and late clinical state when current authority is withdrawn', async () => {
  slowWrite = true; const view = render(<Harness />); await saveCreate(); await waitFor(() => expect(writes).toHaveLength(1)); view.rerender(<Harness actor={{ ...user, adminAccess: { capabilities: ['clinical_documentation.view'] } }} />); expect(screen.getByText('Admission follow-up unavailable')).toBeInTheDocument(); expect(screen.queryByDisplayValue('Synthetic private follow-up note')).not.toBeInTheDocument(); await act(async () => finishWrite()); expect(screen.queryByText(/Follow-up change recorded/)).not.toBeInTheDocument(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
});
it('denies Summary before fetch and keeps an onsite-authorized task read-only on a readonly connection', async () => {
  const view = render(<Harness full={false} />); expect(screen.getByText('Admission follow-up unavailable')).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled(); view.rerender(<Harness readonly />); await screen.findByText(/This connection has review access/); expect(screen.getByRole('button', { name: 'Add follow-up' })).toBeDisabled(); expect(writes).toHaveLength(0);
});
it('paginates actual scoped case choices and exposes a failed page without pretending it is empty', async () => {
  paged = true; render(<Harness requested={null} />); fireEvent.click(await screen.findByRole('button', { name: 'Next cases' })); await screen.findByRole('button', { name: /Synthetic active ward · Admitted/ }); expect(requests.find((row) => row.url.searchParams.has('cursor')).url.searchParams.get('cursor')).toBe('synthetic-page-two'); caseStatus = 503; fireEvent.click(screen.getByRole('button', { name: 'Previous cases' })); await screen.findByText(/Admission cases could not be loaded/); expect(screen.queryByText(/No admission cases are available/)).not.toBeInTheDocument();
});

it('retains a copied draft across a changed context token and requires explicit discard before a new review', async () => {
  render(<Harness />); await draftCreate(); contextToken = 'b'.repeat(64); fireEvent.click(screen.getByRole('button', { name: 'Refresh current evidence' })); await screen.findByText(/The admission context or task changed/); expect(screen.getByLabelText('Follow-up note')).toHaveValue('Synthetic private follow-up note'); expect(screen.getByLabelText('Follow-up note')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Confirm reviewed change' })).toBeDisabled(); expect(writes).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Discard draft and reload' })); await screen.findByRole('button', { name: 'Add follow-up' }); expect(screen.queryByDisplayValue('Synthetic private follow-up note')).not.toBeInTheDocument();
});
it('never remounts a primed cached narrative before its new protected read returns403', async () => {
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } }); rows.set(advisoryId, detail()); render(<Harness />); fireEvent.click(await screen.findByRole('button', { name: /Transport Pending/ })); await screen.findByText('Synthetic private follow-up note'); cleanup(); expect(client.getQueryCache().getAll().some((query) => query.state.data?.notes === 'Synthetic private follow-up note')).toBe(true); contextStatus = 403; render(<Harness />); expect(screen.queryByText('Synthetic private follow-up note')).not.toBeInTheDocument(); await screen.findByText('Admission follow-up unavailable'); expect(screen.queryByText('Synthetic private follow-up note')).not.toBeInTheDocument();
});
