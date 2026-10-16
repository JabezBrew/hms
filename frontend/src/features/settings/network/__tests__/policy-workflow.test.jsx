import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkPolicyEditor } from '../NetworkPolicyEditor';
import { networkApi, NetworkPolicyUnconfirmedError } from '../api';
import { candidatePreview, networkDecision, networkPolicy, networkUser } from './fixtures';

let client; let login; let refresh; let reload;
beforeEach(() => {
  vi.restoreAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 2 } } }); login = vi.fn().mockResolvedValue(networkUser); refresh = vi.fn(); reload = vi.fn();
  vi.spyOn(networkApi, 'preview').mockResolvedValue(candidatePreview);
  vi.spyOn(networkApi, 'current').mockResolvedValue(networkDecision);
  vi.spyOn(networkApi, 'save').mockImplementation(async (payload) => ({ client_request_id: payload.client_request_id, replayed: false, policy: { ...networkPolicy, onsite_cidrs: payload.onsite_cidrs, offsite_mode: payload.offsite_mode, version: payload.expected_version + 1 } }));
});
function page() { return render(<QueryClientProvider client={client}><NetworkPolicyEditor policy={networkPolicy} user={networkUser} reauthenticate={login} readStale={false} onRefresh={refresh} onReload={reload} /></QueryClientProvider>); }
async function check() {
  fireEvent.change(screen.getByLabelText('Approved onsite networks'), { target: { value: '10.10.4.9/24' } }); fireEvent.change(screen.getByLabelText('Reason for this policy version'), { target: { value: ' Synthetic approved network change ' } }); fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: 'Synthetic password ' } }); fireEvent.click(screen.getByRole('button', { name: 'Check current connection' }));
  return screen.findByRole('button', { name: 'Publish reviewed policy' });
}
describe('reviewed network policy workflow', () => {
  it('publishes the explicitly reviewed canonical candidate with exact callback and credential payloads', async () => {
    page(); const publish = await check(); expect(login).toHaveBeenCalledWith(networkUser.email, 'Synthetic password ', 'HMS'); expect(networkApi.preview).toHaveBeenCalledWith({ onsite_cidrs: ['10.10.4.9/24'], offsite_mode: 'readonly' }, expect.objectContaining({ signal: expect.any(AbortSignal) })); expect(networkApi.save).not.toHaveBeenCalled(); expect(screen.getByLabelText('Approved onsite networks')).toBeDisabled();
    expect(screen.getByLabelText('Reviewed network policy')).toHaveTextContent('10.10.4.0/24'); fireEvent.click(publish); await screen.findByText('Policy publication confirmed');
    expect(networkApi.save).toHaveBeenCalledTimes(1); expect(networkApi.save.mock.calls[0][0]).toMatchObject({ expected_version: 3, onsite_cidrs: ['10.10.4.0/24'], offsite_mode: 'readonly', reason: 'Synthetic approved network change', client_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(screen.queryByLabelText('Confirm your current password')).not.toBeInTheDocument();
    expect(JSON.stringify(client.getMutationCache().getAll())).not.toContain('Synthetic password');
  });
  it('refuses a candidate that would remove the current connection', async () => {
    networkApi.preview.mockResolvedValueOnce({ ...candidatePreview, current_connection_retained_onsite: false }); page(); fireEvent.change(screen.getByLabelText('Reason for this policy version'), { target: { value: 'Synthetic reason' } }); fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: 'Synthetic password' } }); fireEvent.click(screen.getByRole('button', { name: 'Check current connection' })); await screen.findByText(/would remove this connection/); expect(screen.queryByRole('button', { name: 'Publish reviewed policy' })).not.toBeInTheDocument(); expect(networkApi.save).not.toHaveBeenCalled(); expect(screen.getByLabelText('Confirm your current password')).toHaveValue('');
  });
  it('does not preview or save after reauthentication changes authority', async () => {
    login.mockResolvedValueOnce({ ...networkUser, adminAccess: { capabilities: [] } }); page(); fireEvent.change(screen.getByLabelText('Reason for this policy version'), { target: { value: 'Synthetic reason' } }); fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: 'Synthetic password' } }); fireEvent.click(screen.getByRole('button', { name: 'Check current connection' })); await screen.findByText(/administration access is no longer available/); expect(networkApi.preview).not.toHaveBeenCalled(); expect(networkApi.save).not.toHaveBeenCalled(); expect(screen.getByLabelText('Confirm your current password')).toHaveValue('');
  });
  it('locks an uncertain command across failed reauthentication and retries only the original UUID and payload', async () => {
    networkApi.save.mockRejectedValueOnce(new NetworkPolicyUnconfirmedError()); page(); fireEvent.click(await check()); await screen.findByText('Policy publication status unknown'); expect(networkApi.save).toHaveBeenCalledTimes(1); const original = structuredClone(networkApi.save.mock.calls[0][0]); expect(screen.getByLabelText('Approved onsite networks')).toBeDisabled(); expect(screen.queryByRole('button', { name: 'Change policy details' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current policy' })); expect(refresh).toHaveBeenCalledTimes(1); login.mockRejectedValueOnce(new Error('Synthetic password denied')); fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: 'Wrong password' } }); fireEvent.click(screen.getByRole('button', { name: 'Retry exact policy change' })); await waitFor(() => expect(login).toHaveBeenCalledTimes(2)); await waitFor(() => expect(screen.getByLabelText('Confirm your current password')).toHaveValue('')); expect(screen.getByLabelText('Reason for this policy version')).toBeDisabled(); expect(networkApi.save).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: 'Synthetic password' } }); fireEvent.click(screen.getByRole('button', { name: 'Retry exact policy change' })); await screen.findByText('Policy publication confirmed'); expect(networkApi.save.mock.calls[1][0]).toEqual(original);
  });
  it('prevents duplicate publication and preserves a confirmed receipt when refresh fails', async () => {
    vi.spyOn(client, 'invalidateQueries').mockRejectedValue(new Error('Synthetic refresh unavailable')); let finish; networkApi.save.mockImplementationOnce((payload) => new Promise((resolve) => { finish = () => resolve({ client_request_id: payload.client_request_id, replayed: false, policy: { ...networkPolicy, version: 4 } }); })); page(); const publish = await check(); fireEvent.click(publish); fireEvent.click(publish); await screen.findByRole('button', { name: 'Publishing…' }); expect(networkApi.save).toHaveBeenCalledTimes(1); await act(async () => finish()); await screen.findByText('Policy publication confirmed'); expect(screen.getByText(/saved version remains confirmed/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Publish reviewed policy' })).not.toBeInTheDocument();
  });
  it('invalidates review before edited values can be published and aborts a pending preview after unmount', async () => {
    const view = page(); await check(); fireEvent.click(screen.getByRole('button', { name: 'Change policy details' })); expect(screen.queryByRole('button', { name: 'Publish reviewed policy' })).not.toBeInTheDocument(); let finish; networkApi.preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })); fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: 'Synthetic password' } }); fireEvent.click(screen.getByRole('button', { name: 'Check current connection' })); await waitFor(() => expect(networkApi.preview).toHaveBeenCalledTimes(2)); const signal = networkApi.preview.mock.calls[1][1].signal; view.unmount(); expect(signal.aborted).toBe(true); await act(async () => finish(candidatePreview)); expect(networkApi.save).not.toHaveBeenCalled();
  });
});
