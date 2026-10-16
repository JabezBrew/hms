import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import AddVitalsSlideOver from '@/components/chronicle/AddVitalsSlideOver';
import ChronicleWorkspaceHost from '@/features/patients/components/ChronicleWorkspaceHost';
const ids = Array.from({ length: 7 }, (_, i) => `44444444-4444-4444-8444-${String(i + 1).padStart(12, '0')}`);
const user = { id: ids[0], accessContext: { facility_id: ids[1], active_profile: 'hospital', patient_visibility: ['full_clinical'], permissions: ['nursing.task.manage'], features: ['nursing'] } };
const decision = { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 };
const patient = { id: ids[2], name: 'Synthetic observation patient', patient_code: 'SYNTHETIC-SECOND-ID' };
const originalRuntime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
let client, success, finish, writes;
const onClose = vi.fn(); const onRecorded = vi.fn();
function Harness({ admission = ids[3], currentPatient = patient, open = true, host = false }) {
  return <AuthContext.Provider value={{ user }}><QueryClientProvider client={client}><ReadOnlyModeProvider network={{ confirmed: true, decision }}>{host ? <ChronicleWorkspaceHost activeWorkspace={open ? 'vitals' : null} workspaceContext={{ patient: { ...currentPatient, current_admission_id: ids[6] }, selectedAdmissionId: admission, activeEncounter: { id: ids[5], admission_id: ids[6] }, clinicalPermissions: { can_view_full_clinical: true, can_record_vitals: true }, onClose, onVitalsRecorded: onRecorded }} /> : <AddVitalsSlideOver open={open} onClose={onClose} patient={currentPatient} admissionId={admission} onVitalsRecorded={onRecorded} />}</ReadOnlyModeProvider></QueryClientProvider></AuthContext.Provider>;
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal: { id: user.id, facility_id: ids[1], active_profile: 'hospital' } }).update({ confirmed: true, decision });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 3 } } }); success = vi.spyOn(toast, 'success'); onClose.mockClear(); onRecorded.mockClear(); writes = [];
  globalThis.fetch = vi.fn((_url, options) => new Promise((resolve) => { const body = JSON.parse(options.body); writes.push(body); finish = (malformed = false) => resolve(new Response(JSON.stringify({ data: { ...body, id: ids[4], patient_id: patient.id, admission_case_id: malformed ? ids[5] : body.admission_case_id } }), { status: 200, headers: { 'content-type': 'application/json' } })); }));
});
afterEach(() => { cleanup(); client.clear(); success.mockRestore(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = originalRuntime; globalThis.fetch = originalFetch; });

it('records a supported observation to the explicitly selected admission with real identity labels and no pain-score no-op', async () => {
  render(<Harness />); expect(screen.getByText(/SYNTHETIC-SECOND-ID/)).toBeInTheDocument(); expect(screen.queryByText('Pain Level')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '37.6' } }); fireEvent.click(screen.getByRole('button', { name: 'Record Vitals' }));
  await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0].admission_case_id).toBe(ids[3]); expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  await act(async () => finish()); await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1)); expect(onClose).toHaveBeenCalledTimes(1); expect(success).toHaveBeenCalledWith('Vital signs recorded');
});
it('removes copied observations on selected-admission changes and removes closed form DOM', () => {
  const view = render(<Harness />); fireEvent.change(screen.getByLabelText('Heart Rate'), { target: { value: '88' } });
  view.rerender(<Harness admission={ids[5]} />); expect(screen.getByLabelText('Heart Rate')).toHaveValue(null);
  view.rerender(<Harness open={false} />); expect(screen.queryByLabelText('Heart Rate')).not.toBeInTheDocument();
});
it('blocks another observation after a malformed actual response even with a global mutation retry policy', async () => {
  render(<Harness />); fireEvent.change(screen.getByLabelText('Heart Rate'), { target: { value: '88' } }); fireEvent.click(screen.getByRole('button', { name: 'Record Vitals' }));
  await waitFor(() => expect(writes).toHaveLength(1)); await act(async () => finish(true)); await screen.findByText(/may have been saved/);
  expect(screen.getByRole('button', { name: 'Record Vitals' })).toBeDisabled(); expect(screen.getByLabelText('Heart Rate')).toBeDisabled(); expect(writes).toHaveLength(1); expect(onRecorded).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
});
it('does not publish a previous patient response into the new patient form', async () => {
  const view = render(<Harness />); fireEvent.change(screen.getByLabelText('Heart Rate'), { target: { value: '88' } }); fireEvent.click(screen.getByRole('button', { name: 'Record Vitals' }));
  await waitFor(() => expect(writes).toHaveLength(1)); const finishOld = finish;
  view.rerender(<Harness currentPatient={{ ...patient, id: ids[6], name: 'Synthetic next patient', patient_code: 'SYNTHETIC-NEXT-ID' }} />);
  await act(async () => finishOld()); expect(screen.getByText(/SYNTHETIC-NEXT-ID/)).toBeInTheDocument(); expect(screen.getByLabelText('Heart Rate')).toHaveValue(null); expect(success).not.toHaveBeenCalled(); expect(onRecorded).not.toHaveBeenCalled();
});

it.each(['Heart Rate', 'Systolic blood pressure'])('rejects a fractional %s without truncating or posting the observation', (label) => {
  render(<Harness />);
  if (label === 'Systolic blood pressure') fireEvent.change(screen.getByLabelText('Diastolic blood pressure'), { target: { value: '80' } });
  fireEvent.change(screen.getByLabelText(label), { target: { value: label === 'Heart Rate' ? '80.5' : '120.9' } }); fireEvent.click(screen.getByRole('button', { name: 'Record Vitals' }));
  expect(screen.getByText('Enter a whole number')).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled(); expect(onRecorded).not.toHaveBeenCalled();
});


it('uses the actual Host selected admission before current-admission fallback and clears copied values when selection changes', async () => {
  const view = render(<Harness host />);
  fireEvent.change(await screen.findByLabelText('Heart Rate'), { target: { value: '88' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record Vitals' }));
  await waitFor(() => expect(writes).toHaveLength(1)); expect(writes[0].admission_case_id).toBe(ids[3]); expect(writes[0].patient_id).toBe(patient.id);
  const finishOld = finish; view.rerender(<Harness host admission={ids[5]} />);
  expect(await screen.findByLabelText('Heart Rate')).toHaveValue(null); await act(async () => finishOld()); expect(success).not.toHaveBeenCalled(); expect(onRecorded).not.toHaveBeenCalled();
});
