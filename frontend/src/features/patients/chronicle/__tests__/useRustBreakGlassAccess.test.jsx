import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patientsApi } from '@/features/patients/api';
import { useRustBreakGlassAccess } from '../useRustBreakGlassAccess';

vi.mock('@/features/patients/api', () => ({ patientsApi: {
  getBreakGlassStatus: vi.fn(), requestBreakGlass: vi.fn(), endBreakGlass: vi.fn(),
} }));

const user = {
  id: 'actor-1', email: 'synthetic@example.com', facilityCode: 'HMS',
  adminAccess: { capabilities: ['patient.break_glass.invoke'] },
  accessContext: { facility_id: 'facility-1', active_profile: 'full' },
};
const payload = { password: 'Synthetic password ', category: 'urgent_clinical_continuity', reason: '  Urgent handover  ' };
let currentGrant;
let queryClient;
let reauthenticate;
let refetchContext;
function setup(overrides = {}) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook((props) => useRustBreakGlassAccess({ enabled: true, patientId: 'patient-1', user, reauthenticate, refetchContext, ...props }), { wrapper, initialProps: overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  currentGrant = null;
  reauthenticate = vi.fn().mockResolvedValue(user);
  refetchContext = vi.fn().mockResolvedValue({ data: {} });
  patientsApi.getBreakGlassStatus.mockImplementation(async () => ({ grant: currentGrant && Date.parse(currentGrant.expires_at) > Date.now() ? currentGrant : null }));
  patientsApi.requestBreakGlass.mockImplementation(async () => {
    currentGrant = { id: 'grant-1', expires_at: new Date(Date.now() + 7200000).toISOString() };
    return { ...currentGrant, patient_id: 'patient-1', user_id: user.id, facility_id: 'facility-1' };
  });
  patientsApi.endBreakGlass.mockImplementation(async () => { currentGrant = null; return { ended_count: 1 }; });
});
afterEach(() => { queryClient?.clear(); vi.useRealTimers(); });

describe('Rust emergency access lifecycle', () => {
  it('keeps a malformed grant receipt unconfirmed and prevents another create', async () => {
    patientsApi.requestBreakGlass.mockResolvedValueOnce({ id: 'grant-1', patient_id: 'different-patient' });
    const { result } = setup();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    await act(async () => { expect(await result.current.submit(payload)).toBe(false); });
    expect(result.current.unconfirmed).toBe(true);
    await act(async () => { await result.current.submit(payload); });
    expect(patientsApi.requestBreakGlass).toHaveBeenCalledTimes(1);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('does not confirm an invalid ended_count %s', async (endedCount) => {
    currentGrant = { id: 'existing-grant', expires_at: new Date(Date.now() + 300000).toISOString() };
    patientsApi.endBreakGlass.mockResolvedValueOnce({ ended_count: endedCount });
    const { result } = setup();
    await waitFor(() => expect(result.current.grant?.id).toBe('existing-grant'));
    await act(async () => { await result.current.end(); });
    expect(result.current.unconfirmed).toBe(true);
    expect(result.current.error).toMatch(/may already have ended/);
  });

  it('requires dedicated permission and known current status before requesting a grant', async () => {
    const view = setup({ user: { ...user, adminAccess: { capabilities: [] } } });
    await act(async () => { expect(await view.result.current.submit(payload)).toBe(false); });
    expect(patientsApi.getBreakGlassStatus).not.toHaveBeenCalled();
    expect(reauthenticate).not.toHaveBeenCalled();
    view.rerender({});
    await waitFor(() => expect(view.result.current.statusLoading).toBe(false));
  });

  it('freshly signs into the same scope, posts only typed clinical fields, and never caches the password', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    await act(async () => { expect(await result.current.submit(payload)).toBe(true); });
    expect(reauthenticate).toHaveBeenCalledWith(user.email, 'Synthetic password ', 'HMS', { signal: expect.any(AbortSignal) });
    expect(patientsApi.requestBreakGlass).toHaveBeenCalledWith('patient-1', {
      category: payload.category, reason_text: 'Urgent handover',
    }, { signal: expect.any(AbortSignal) });
    expect(result.current.grant).toEqual(currentGrant);
    expect(refetchContext).toHaveBeenCalled();
    expect(queryClient.getMutationCache().getAll()).toEqual([]);
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => [query.queryKey, query.state.data]))).not.toContain(payload.password);
  });

  it.each([
    { id: 'other-actor' }, { facilityCode: 'OTHER' },
    { accessContext: { facility_id: 'other-facility', active_profile: 'full' } },
    { accessContext: { facility_id: 'facility-1', active_profile: 'limited' } },
    { adminAccess: { capabilities: [] } },
  ])('rejects a changed identity or authorization scope after password confirmation: %j', async (change) => {
    reauthenticate.mockResolvedValueOnce({ ...user, ...change });
    const { result } = setup();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    await act(async () => { await result.current.submit(payload); });
    expect(patientsApi.requestBreakGlass).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/account or access scope changed/);
  });

  it('stops after denied password confirmation and exposes a definite grant denial without claiming success', async () => {
    reauthenticate.mockRejectedValueOnce(new Error('Password not accepted'));
    const { result } = setup();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    await act(async () => { await result.current.submit(payload); });
    expect(result.current.error).toBe('Password not accepted');
    expect(patientsApi.requestBreakGlass).not.toHaveBeenCalled();
    patientsApi.requestBreakGlass.mockRejectedValueOnce(Object.assign(new Error('Fresh authentication required'), { status: 403 }));
    await act(async () => { await result.current.submit(payload); });
    expect(result.current.grant).toBeNull();
    expect(result.current.error).toBe('Fresh authentication required');
    expect(result.current.unconfirmed).toBe(false);
  });

  it('does not retry an uncertain create and allows the idempotent end path to resolve it', async () => {
    patientsApi.requestBreakGlass.mockRejectedValueOnce(new Error('Lost response'));
    const { result } = setup();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    await act(async () => { await result.current.submit(payload); });
    expect(result.current.unconfirmed).toBe(true);
    expect(result.current.error).toMatch(/grant may already exist/);
    await act(async () => { await result.current.submit(payload); });
    expect(patientsApi.requestBreakGlass).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.end(); });
    expect(result.current.unconfirmed).toBe(false);
    expect(result.current.grant).toBeNull();
  });

  it('distinguishes a confirmed grant from a failed record refresh and prevents duplicate creation', async () => {
    refetchContext.mockResolvedValue({ isError: true, error: new Error('Unavailable') });
    const { result } = setup();
    await waitFor(() => expect(result.current.statusLoading).toBe(false));
    await act(async () => { expect(await result.current.submit(payload)).toBe(true); });
    expect(result.current.grant?.id).toBe('grant-1');
    expect(result.current.refreshError).toBe(true);
    await act(async () => { await result.current.submit(payload); });
    expect(patientsApi.requestBreakGlass).toHaveBeenCalledTimes(1);
  });

  it('restores only the current server grant and ends it with a record authorization refresh', async () => {
    currentGrant = { id: 'existing-grant', expires_at: new Date(Date.now() + 300000).toISOString() };
    const { result } = setup();
    await waitFor(() => expect(result.current.grant?.id).toBe('existing-grant'));
    await act(async () => { await result.current.submit(payload); });
    expect(reauthenticate).not.toHaveBeenCalled();
    await act(async () => { await result.current.end(); });
    expect(patientsApi.endBreakGlass).toHaveBeenCalledWith('patient-1', { signal: expect.any(AbortSignal) });
    expect(result.current.grant).toBeNull();
    expect(refetchContext).toHaveBeenCalled();
  });

  it('prevents duplicate submissions and aborts grant creation after leaving the record during reauthentication', async () => {
    let finishLogin;
    reauthenticate.mockImplementationOnce(() => new Promise((resolve) => { finishLogin = resolve; }));
    const view = setup();
    await waitFor(() => expect(view.result.current.statusLoading).toBe(false));
    let pending;
    act(() => { pending = view.result.current.submit(payload); });
    await act(async () => { await view.result.current.submit(payload); });
    expect(reauthenticate).toHaveBeenCalledTimes(1);
    const signal = reauthenticate.mock.calls[0][3].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { finishLogin(user); await pending; });
    expect(patientsApi.requestBreakGlass).not.toHaveBeenCalled();
  });

  it('blocks creation while status is unknown and permits a deliberate status retry', async () => {
    patientsApi.getBreakGlassStatus.mockRejectedValueOnce(new Error('Unavailable'));
    const { result } = setup();
    await waitFor(() => expect(result.current.statusError).toBe(true));
    await act(async () => { await result.current.submit(payload); });
    expect(reauthenticate).not.toHaveBeenCalled();
    await act(async () => { await result.current.refreshAccess(); });
    await waitFor(() => expect(result.current.statusError).toBe(false));
    expect(result.current.grant).toBeNull();
  });

  it('clears a server expiry and refreshes authorization without creating a new grant', async () => {
    currentGrant = { id: 'expiring-grant', expires_at: new Date(Date.now() + 150).toISOString() };
    const { result } = setup();
    await waitFor(() => expect(result.current.grant?.id).toBe('expiring-grant'));
    await waitFor(() => expect(result.current.grant).toBeNull());
    expect(refetchContext).toHaveBeenCalled();
    expect(patientsApi.requestBreakGlass).not.toHaveBeenCalled();
  });

  it('does not claim access ended when the end response is denied', async () => {
    currentGrant = { id: 'existing-grant', expires_at: new Date(Date.now() + 300000).toISOString() };
    patientsApi.endBreakGlass.mockRejectedValueOnce(Object.assign(new Error('End access denied'), { status: 403 }));
    const { result } = setup();
    await waitFor(() => expect(result.current.grant?.id).toBe('existing-grant'));
    await act(async () => { await result.current.end(); });
    expect(result.current.grant?.id).toBe('existing-grant');
    expect(result.current.error).toBe('End access denied');
  });

  it('fails closed and clears cached reads when the end saved but its response was lost', async () => {
    currentGrant = { id: 'existing-grant', expires_at: new Date(Date.now() + 300000).toISOString() };
    patientsApi.endBreakGlass.mockImplementationOnce(async () => { currentGrant = null; throw new Error('Lost response'); });
    refetchContext.mockResolvedValue({ isError: true, error: { status: 403 } });
    const { result } = setup();
    queryClient.setQueryData(['patients', 'detail', 'patient-1', 'chronicle', 'startup'], { syntheticClinicalData: true });
    await waitFor(() => expect(result.current.grant?.id).toBe('existing-grant'));
    await act(async () => { await result.current.end(); });
    expect(result.current.grant).toBeNull();
    expect(result.current.blocked).toBe(true);
    expect(result.current.unconfirmed).toBe(true);
    expect(result.current.error).toMatch(/grant may already have ended/);
    expect(queryClient.getQueryData(['patients', 'detail', 'patient-1', 'chronicle', 'startup'])).toBeUndefined();
    expect(patientsApi.endBreakGlass).toHaveBeenCalledTimes(1);
  });

  it('refreshes clinical authorization when the server reports a grant ended elsewhere', async () => {
    currentGrant = { id: 'existing-grant', expires_at: new Date(Date.now() + 300000).toISOString() };
    refetchContext.mockResolvedValue({ isError: true, error: { status: 403 } });
    const { result } = setup();
    await waitFor(() => expect(result.current.grant?.id).toBe('existing-grant'));
    currentGrant = null;
    await act(async () => { await result.current.refreshAccess(); });
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(refetchContext).toHaveBeenCalled();
    expect(patientsApi.requestBreakGlass).not.toHaveBeenCalled();
  });

  it('checks expiry only once per server grant when the browser clock is ahead', async () => {
    currentGrant = { id: 'clock-skew-grant', expires_at: new Date(Date.now() - 1000).toISOString() };
    patientsApi.getBreakGlassStatus.mockImplementation(async () => ({ grant: currentGrant }));
    const { result } = setup();
    await waitFor(() => expect(refetchContext).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.grant?.id).toBe('clock-skew-grant'));
    expect(patientsApi.getBreakGlassStatus).toHaveBeenCalledTimes(2);
    expect(refetchContext).toHaveBeenCalledTimes(1);
  });

  it('does not let an older authorization refresh reopen content after End starts', async () => {
    currentGrant = { id: 'existing-grant', expires_at: new Date(Date.now() + 300000).toISOString() };
    let finishOldRefresh;
    let failEndResponse;
    refetchContext.mockImplementationOnce(() => new Promise((resolve) => { finishOldRefresh = resolve; }))
      .mockResolvedValue({ isError: true, error: { status: 403 } });
    patientsApi.endBreakGlass.mockImplementationOnce(() => {
      currentGrant = null;
      return new Promise((_resolve, reject) => { failEndResponse = reject; });
    });
    const { result } = setup();
    await waitFor(() => expect(refetchContext).toHaveBeenCalledTimes(1));
    let ending;
    act(() => { ending = result.current.end(); });
    expect(result.current.blocked).toBe(true);
    await act(async () => { finishOldRefresh({ data: {} }); });
    expect(result.current.blocked).toBe(true);
    expect(result.current.busy).toBe(true);
    await act(async () => { failEndResponse(new Error('Lost response')); await ending; });
    expect(result.current.blocked).toBe(true);
    expect(result.current.unconfirmed).toBe(true);
  });

  it.each(['break_glass', 'workflow'])('a failed status read blocks only grant-dependent content: %s', async (accessSource) => {
    currentGrant = { id: 'existing-grant', expires_at: new Date(Date.now() + 300000).toISOString() };
    const { result } = setup({ accessSource });
    await waitFor(() => expect(result.current.grant?.id).toBe('existing-grant'));
    await waitFor(() => expect(result.current.blocked).toBe(false));
    patientsApi.getBreakGlassStatus.mockRejectedValueOnce(new Error('Unavailable'));
    await act(async () => { await result.current.refreshAccess(); });
    await waitFor(() => expect(result.current.statusError).toBe(true));
    expect(result.current.blocked).toBe(accessSource === 'break_glass');
    expect(result.current.grant?.id).toBe('existing-grant');
  });

  it('polls an active grant every fifteen seconds and discovers an end on another device', async () => {
    currentGrant = { id: 'existing-grant', expires_at: new Date(Date.now() + 300000).toISOString() };
    const { result } = setup({ accessSource: 'break_glass' });
    await waitFor(() => expect(result.current.grant?.id).toBe('existing-grant'));
    await waitFor(() => expect(result.current.blocked).toBe(false));
    const query = queryClient.getQueryCache().getAll().find((entry) => entry.queryKey.includes('emergency-access'));
    expect(query.options.refetchOnWindowFocus).toBe(true);
    expect(query.options.refetchInterval(query)).toBe(15000);
    currentGrant = null;
    refetchContext.mockResolvedValue({ isError: true, error: { status: 403 } });
    await act(async () => { await query.fetch(); });
    await waitFor(() => expect(result.current.grant).toBeNull());
    await waitFor(() => expect(result.current.blocked).toBe(true));
    expect(query.options.refetchInterval(query)).toBe(false);
  });
});
