import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChronicleBreakGlassAccess } from '../useChronicleBreakGlassAccess';
import { ChronicleAccessDeniedState } from '../ChronicleAccessDeniedState';
import { patientKeys, usePatientChronicleStartup } from '@/features/patients/hooks/usePatientQueries';

const api = vi.hoisted(() => ({ requestBreakGlass: vi.fn(), endBreakGlass: vi.fn(), getPatientChronicleStartup: vi.fn() }));
vi.mock('@/features/patients/api', () => ({ patientsApi: api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const user = { id: 'synthetic-clinician', role: 'doctor', accessContext: { facility_id: 'synthetic-facility', session_version: 1, permissions: ['patient.break_glass.invoke'] } };
const denied = { status: 403, message: 'Access denied' };
const data = { patient: { id: 'synthetic-patient' }, syntheticClinicalValue: 'PRIVATE_SYNTHETIC_RECORD' };
const grant = (extra = {}) => ({ patient_id: 'synthetic-patient', started_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7_200_000).toISOString(), ended_at: null, ...extra });
let client;
const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
function Workspace({ actor = user } = {}) {
  const record = usePatientChronicleStartup('synthetic-patient');
  const state = useChronicleBreakGlassAccess({ patientId: 'synthetic-patient', user: actor, rustV2Mode: true, isLoading: record.isLoading, startupError: record.error, refetchContext: record.refetch });
  if (state.accessDenied) return <ChronicleAccessDeniedState
    {...state} isSubmitting={state.isSubmittingBreakGlass} rustV2Mode
    onBreakGlassOpenChange={state.setBreakGlassOpen} onBreakGlassReasonChange={state.setBreakGlassReason}
    onBreakGlassCategoryChange={state.setBreakGlassCategory} onBreakGlassConfirmedChange={state.setBreakGlassConfirmed}
    onBreakGlassSubmit={state.submitBreakGlass} onEndBreakGlass={state.endBreakGlass} onCheckRecordAccess={state.checkRecordAccess}
    onSignInAgain={vi.fn()}
  />;
  return <><p>{record.data?.syntheticClinicalValue}</p>{state.canRequestBreakGlass && <button onClick={state.endBreakGlass}>End emergency access</button>}</>;
}
async function fillDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Request Break-Glass Access' }));
  fireEvent.change(screen.getByLabelText('Reason for access'), { target: { value: 'Synthetic urgent clinical continuity' } });
  fireEvent.click(screen.getByRole('checkbox'));
}
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } } });
  api.getPatientChronicleStartup.mockRejectedValue(denied);
  api.requestBreakGlass.mockImplementation(async () => grant());
  api.endBreakGlass.mockResolvedValue({ ended_count: 1 });
});
afterEach(() => { client.clear(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native emergency access', () => {
  it('requires dedicated permission and never grants from a role alone', async () => {
    render(<Workspace actor={{ id: 'synthetic-other', role: 'admin' }} />, { wrapper });
    await screen.findByText('Team-based access required');
    expect(screen.queryByRole('button', { name: 'Request Break-Glass Access' })).not.toBeInTheDocument();
    expect(api.requestBreakGlass).not.toHaveBeenCalled();
  });
  it('requires confirmation and preserves input when cancelled without a request', async () => {
    render(<Workspace />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Request Break-Glass Access' }));
    fireEvent.change(screen.getByLabelText('Reason for access'), { target: { value: 'Synthetic urgent care reason' } });
    expect(screen.getByRole('button', { name: 'Grant Access' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.requestBreakGlass).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Request Break-Glass Access' }));
    expect(screen.getByLabelText('Reason for access')).toHaveValue('Synthetic urgent care reason');
    expect(screen.getByLabelText('Reason for access')).toHaveAttribute('maxlength', '500');
  });
  it('sends the native DTO once and reveals the record only after a fresh successful read', async () => {
    api.getPatientChronicleStartup.mockRejectedValueOnce(denied).mockResolvedValue(data);
    render(<Workspace />, { wrapper });
    await fillDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Grant Access' }));
    await screen.findByText('PRIVATE_SYNTHETIC_RECORD');
    expect(api.requestBreakGlass).toHaveBeenCalledExactlyOnceWith('synthetic-patient', { category: 'urgent_clinical_continuity', reason_text: 'Synthetic urgent clinical continuity' });
    expect(api.getPatientChronicleStartup.mock.calls.length).toBeGreaterThan(1);
  });
  it.each(['permission_denied', 'reauth_required', 'break_glass_grant_exists'])('retains reason on %s without replaying the mutation', async (code) => {
    api.requestBreakGlass.mockRejectedValue({ status: 403, message: 'Synthetic rejection', data: { error: { code } } });
    render(<Workspace />, { wrapper });
    await fillDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Grant Access' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByLabelText('Reason for access')).toHaveValue('Synthetic urgent clinical continuity');
    expect(api.requestBreakGlass).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('PRIVATE_SYNTHETIC_RECORD')).not.toBeInTheDocument();
    if (code === 'reauth_required') expect(screen.getByRole('button', { name: 'Sign out to verify identity' })).toBeInTheDocument();
  });
  it('keeps PHI hidden and discards cached data when the post-grant read fails', async () => {
    api.getPatientChronicleStartup.mockRejectedValueOnce(denied).mockRejectedValue({ status: 503, message: 'Unavailable' });
    render(<Workspace />, { wrapper });
    await fillDialog();
    client.setQueryData([...patientKeys.detail('synthetic-patient'), 'cached-note'], { private: 'PRIVATE_SYNTHETIC_RECORD' });
    fireEvent.click(screen.getByRole('button', { name: 'Grant Access' }));
    await screen.findByText(/record access could not be verified/i);
    expect(screen.queryByText('PRIVATE_SYNTHETIC_RECORD')).not.toBeInTheDocument();
    expect(client.getQueryData([...patientKeys.detail('synthetic-patient'), 'cached-note'])).toBeUndefined();
    expect(api.requestBreakGlass).toHaveBeenCalledTimes(1);
  });
  it('allows ending an existing grant after reload without claiming it is active', async () => {
    api.getPatientChronicleStartup.mockResolvedValueOnce(data).mockRejectedValue(denied);
    render(<Workspace />, { wrapper });
    await screen.findByText('PRIVATE_SYNTHETIC_RECORD');
    fireEvent.click(screen.getByRole('button', { name: 'End emergency access' }));
    await screen.findByText('Team-based access required');
    await waitFor(() => expect(api.endBreakGlass).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('PRIVATE_SYNTHETIC_RECORD')).not.toBeInTheDocument();
  });
  it('locks the local record when an end response is lost and never retries automatically', async () => {
    api.getPatientChronicleStartup.mockResolvedValue(data);
    api.endBreakGlass.mockRejectedValue(new Error('Lost response'));
    render(<Workspace />, { wrapper });
    await screen.findByText('PRIVATE_SYNTHETIC_RECORD');
    fireEvent.click(screen.getByRole('button', { name: 'End emergency access' }));
    await screen.findByText(/ending emergency access could not be confirmed/i);
    expect(screen.queryByText('PRIVATE_SYNTHETIC_RECORD')).not.toBeInTheDocument();
    expect(api.endBreakGlass).toHaveBeenCalledTimes(1);
  });
  it('drops grant state on patient/facility/session change and ignores a late grant response', async () => {
    let resolveGrant;
    api.requestBreakGlass.mockImplementation(() => new Promise((resolve) => { resolveGrant = resolve; }));
    const refetchContext = vi.fn().mockResolvedValue({ data });
    const { result, rerender } = renderHook((props) => useChronicleBreakGlassAccess({ ...props, user, rustV2Mode: true, refetchContext }), { wrapper, initialProps: { patientId: 'synthetic-patient', facilityCode: 'ONE' } });
    act(() => { result.current.setBreakGlassReason('Synthetic urgent care reason'); result.current.setBreakGlassConfirmed(true); });
    act(() => result.current.submitBreakGlass());
    await waitFor(() => expect(api.requestBreakGlass).toHaveBeenCalledTimes(1));
    rerender({ patientId: 'another-synthetic-patient', facilityCode: 'TWO' });
    await act(async () => { resolveGrant(grant()); });
    expect(result.current.breakGlassExpiresAt).toBeNull();
    expect(result.current.breakGlassReason).toBe('');
  });
  it('bounds expiry by the server lifetime even with a clock four hours behind', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    api.requestBreakGlass.mockResolvedValue(grant({ started_at: new Date(Date.now() + 14_400_000).toISOString(), expires_at: new Date(Date.now() + 21_600_000).toISOString() }));
    const refetchContext = vi.fn().mockResolvedValueOnce({ data }).mockResolvedValue({ error: denied, isError: true });
    const { result } = renderHook(() => useChronicleBreakGlassAccess({ patientId: 'synthetic-patient', user, rustV2Mode: true, refetchContext }), { wrapper });
    act(() => { result.current.setBreakGlassReason('Synthetic emergency reason'); result.current.setBreakGlassConfirmed(true); });
    await act(async () => { result.current.submitBreakGlass(); await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.breakGlassExpiresAt).not.toBeNull();
    client.setQueryData(patientKeys.detail('synthetic-patient'), data);
    await act(async () => { await vi.advanceTimersByTimeAsync(7_200_001); });
    expect(result.current.breakGlassExpiresAt).toBeNull();
    expect(result.current.accessDenied).toBe(true);
    expect(client.getQueryData(patientKeys.detail('synthetic-patient'))).toBeUndefined();
    expect(api.requestBreakGlass).toHaveBeenCalledTimes(1);
  });
  it('preserves the legacy payload and role flow', async () => {
    api.requestBreakGlass.mockResolvedValue({ break_glass: { expires_at: new Date(Date.now() + 1_800_000).toISOString() } });
    const refetch = vi.fn();
    const { result } = renderHook(() => useChronicleBreakGlassAccess({ patientId: 'synthetic-patient', user: { role: 'doctor' }, rustV2Mode: false, refetchPatient: refetch }), { wrapper });
    act(() => result.current.setBreakGlassReason('Synthetic legacy urgent reason'));
    act(() => result.current.submitBreakGlass());
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(api.requestBreakGlass).toHaveBeenCalledExactlyOnceWith('synthetic-patient', { reason: 'Synthetic legacy urgent reason', scope: 'clinical' });
  });
});
