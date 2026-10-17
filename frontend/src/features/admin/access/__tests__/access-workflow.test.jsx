import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminAccessApi } from '../api';
import { useRevokeAccessGrant } from '../useAdminAccess';
import { RevokeAccessGrantDialog } from '../RevokeAccessGrantDialog';
vi.mock('../api', () => ({ adminAccessApi: { list: vi.fn(), revoke: vi.fn() } }));
const user = { id: 'actor-1', email: 'synthetic@example.com', facilityCode: 'HMS', accessContext: { facility_id: 'facility-1', active_profile: 'hospital' }, adminAccess: { capabilities: ['admin.authority.manage'] } };
const grant = { id: 'grant-1', kind: 'permission_assignment', display_name: 'Synthetic staff', permission_code: 'admin.staff.view', reconciliation_required: false };
const saved = { ...grant, user_id: 'target-1', status: 'revoked', revoked_at: '2026-10-15T12:00:00Z', independent_access_retained: false, effective_permission_remaining: false };
let client; let login;
function wrapper({ children }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }
function setup(props = {}) { return renderHook(() => useRevokeAccessGrant({ grant, user, reauthenticate: login, ...props }), { wrapper }); }
function dialog(props = {}) { return render(<RevokeAccessGrantDialog grant={grant} user={user} reauthenticate={login} onClose={vi.fn()} onRefresh={vi.fn()} {...props} />, { wrapper }); }
const credentials = { password: 'Synthetic password ' };
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 1 } } }); login = vi.fn().mockResolvedValue(user); adminAccessApi.revoke.mockResolvedValue(saved); });
afterEach(() => client.clear());
describe('managed access revocation', () => {
  it('confirms the same account, sends explicit reconciliation and never caches a password', async () => {
    const { result } = setup();
    await act(async () => expect(await result.current.submit({ ...credentials, reconciliation: 'remove_historical_copy' })).toBe(true));
    expect(login).toHaveBeenCalledWith(user.email, credentials.password, 'HMS', { signal: expect.any(AbortSignal) });
    expect(adminAccessApi.revoke).toHaveBeenCalledWith(grant.kind, grant.id, 'remove_historical_copy', { signal: expect.any(AbortSignal) });
    expect(result.current.saved).toEqual(saved); expect(client.getMutationCache().getAll()).toEqual([]);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(credentials.password);
  });
  it.each([{ id: 'other' }, { facilityCode: 'OTHER' }, { accessContext: { facility_id: 'other', active_profile: 'hospital' } }, { accessContext: { facility_id: 'facility-1', active_profile: 'clinic' } }, { adminAccess: { capabilities: [] } }])('rejects identity or scope changed after reauthentication: %j', async (change) => {
    login.mockResolvedValueOnce({ ...user, ...change }); const { result } = setup();
    await act(async () => { await result.current.submit(credentials); });
    expect(adminAccessApi.revoke).not.toHaveBeenCalled(); expect(result.current.error).toMatch(/account or access scope changed/);
  });
  it('does not write when capability or password confirmation is denied', async () => {
    const denied = setup({ user: { ...user, adminAccess: { capabilities: [] } } });
    await act(async () => { await denied.result.current.submit(credentials); }); expect(login).not.toHaveBeenCalled(); denied.unmount();
    login.mockRejectedValueOnce(new Error('Password was not accepted')); const { result } = setup();
    await act(async () => { await result.current.submit(credentials); }); expect(adminAccessApi.revoke).not.toHaveBeenCalled(); expect(result.current.error).toBe('Password was not accepted');
  });
  it('never automatically retries an uncertain response despite global mutation retries', async () => {
    adminAccessApi.revoke.mockRejectedValueOnce(new Error('Response lost after commit')); const { result } = setup();
    await act(async () => { await result.current.submit(credentials); });
    expect(adminAccessApi.revoke).toHaveBeenCalledTimes(1); expect(result.current.unconfirmed).toBe(true); expect(result.current.saved).toBeNull(); expect(result.current.error).toMatch(/may already be revoked/);
    await act(async () => { await result.current.submit(credentials); }); expect(adminAccessApi.revoke).toHaveBeenCalledTimes(2); expect(result.current.saved).toEqual(saved);
  });
  it('keeps the first reconciliation immutable during an explicit retry after an uncertain conflict', async () => {
    adminAccessApi.revoke.mockRejectedValueOnce(Object.assign(new Error('Commit result unknown'), { status: 409, data: { error: { code: 'access_grant_revoke_failed' } } }));
    const { result } = setup();
    await act(async () => { await result.current.submit({ ...credentials, reconciliation: 'retain_independent' }); });
    expect(result.current.unconfirmed).toBe(true);
    await act(async () => { await result.current.submit({ ...credentials, reconciliation: 'remove_historical_copy' }); });
    expect(adminAccessApi.revoke.mock.calls[1][2]).toBe('retain_independent');
  });
  it('preserves confirmed revocation across list-refresh failure', async () => {
    vi.spyOn(client, 'invalidateQueries').mockRejectedValueOnce(new Error('Read unavailable')); const { result } = setup();
    await act(async () => expect(await result.current.submit(credentials)).toBe(true)); expect(result.current.saved).toEqual(saved); expect(result.current.refreshFailed).toBe(true); expect(result.current.error).toBeNull();
  });
  it('guards duplicate submission and navigation during password confirmation', async () => {
    let resolve; login.mockImplementationOnce(() => new Promise((done) => { resolve = done; })); const view = setup(); let pending;
    act(() => { pending = view.result.current.submit(credentials); });
    await act(async () => expect(await view.result.current.submit(credentials)).toBe(false)); expect(login).toHaveBeenCalledTimes(1); const signal = login.mock.calls[0][3].signal; view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { resolve(user); await pending; }); expect(adminAccessApi.revoke).not.toHaveBeenCalled();
  });
  it('requires a historical choice and clears the password after a definite denial', async () => {
    adminAccessApi.revoke.mockRejectedValueOnce(Object.assign(new Error('Fresh authentication required'), { status: 403 })); dialog({ grant: { ...grant, reconciliation_required: true } });
    const password = screen.getByLabelText('Confirm your current password'); fireEvent.change(password, { target: { value: credentials.password } }); expect(screen.getByRole('button', { name: 'Revoke grant' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Remove the historical copy/ })); fireEvent.click(screen.getByRole('button', { name: 'Revoke grant' }));
    await screen.findByText('Fresh authentication required'); expect(password).toHaveValue(''); expect(screen.queryByText('Revocation confirmed')).not.toBeInTheDocument();
  });
  it('cancels without writing and displays independent rights truthfully after a save', async () => {
    const close = vi.fn(); const view = dialog({ onClose: close }); fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: credentials.password } }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(close).toHaveBeenCalled(); expect(adminAccessApi.revoke).not.toHaveBeenCalled(); view.unmount();
    adminAccessApi.revoke.mockResolvedValueOnce({ ...saved, independent_access_retained: true, effective_permission_remaining: true }); dialog(); fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: credentials.password } }); fireEvent.click(screen.getByRole('button', { name: 'Revoke grant' }));
    await screen.findByText('Revocation confirmed'); expect(screen.getByText(/Independent direct access/)).toBeInTheDocument(); expect(screen.getByText(/another valid source/)).toBeInTheDocument(); expect(screen.queryByText(/No effective facility-wide access/)).not.toBeInTheDocument();
  });
});
