import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NetworkAccessNotice } from '../NetworkAccessNotice';
import { NetworkSessionConfirmation } from '../NetworkSessionConfirmation';
import { networkApi } from '../api';
import { networkDecision, networkUser } from './fixtures';

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());
describe('authoritative network status and credential confirmation', () => {
  it.each([
    [{ ...networkDecision, reason: 'policy_unconfigured', policy_version: null, read_only: true }, 'Network policy needs operator setup'],
    [{ ...networkDecision, classification: 'unknown', reason: 'client_unknown', read_only: true }, 'Network origin could not be verified'],
    [{ ...networkDecision, classification: 'offsite', mode: 'deny', reason: 'offsite_denied', access_allowed: false, read_only: true }, 'Workflow access is blocked on this network'],
    [{ ...networkDecision, classification: 'offsite', mode: 'fresh_reauth', reason: 'reauth_required', reauth_required: true, access_allowed: false, read_only: true }, 'A fresh sign-in is required'],
    [{ ...networkDecision, classification: 'offsite', reason: 'offsite_readonly', read_only: true }, 'Read-only network access'],
    [{ ...networkDecision, classification: 'offsite', reason: 'offsite_fresh_reauth', mode: 'fresh_reauth' }, 'Offsite access with a current sign-in'],
    [networkDecision, 'Approved network connection'],
  ])('explains the actual server decision without exposing an address: %s', (decision, title) => {
    render(<NetworkAccessNotice decision={{ ...decision, client_ip: '203.0.113.5', onsite_cidrs: ['10.10.0.0/16'] }} />); expect(screen.getByText(title)).toBeInTheDocument(); expect(screen.queryByText(/203\.0\.113|10\.10/)).not.toBeInTheDocument();
  });
  it('hides a cached approved label after status read failure', () => { const refresh = vi.fn(); render(<NetworkAccessNotice decision={networkDecision} error onRefresh={refresh} />); expect(screen.queryByText('Approved network connection')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Refresh network access' })); expect(refresh).toHaveBeenCalledTimes(1); });
  it('stops claiming a current offsite sign-in at the exact deadline without another status response', async () => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-16T00:00:00Z')); render(<NetworkAccessNotice decision={{ ...networkDecision, classification: 'offsite', mode: 'fresh_reauth', reason: 'offsite_fresh_reauth', reauth_expires_at: '2026-10-16T00:00:01Z' }} />); expect(screen.getByText('Offsite access with a current sign-in')).toBeInTheDocument(); await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(screen.queryByText('Offsite access with a current sign-in')).not.toBeInTheDocument(); expect(screen.getByText('A fresh sign-in is required')).toBeInTheDocument(); });
  it('reevaluates the current connection after same-scope password confirmation, retaining a read-only result', async () => {
    const decision = { ...networkDecision, classification: 'unknown', reason: 'client_unknown', read_only: true }; vi.spyOn(networkApi, 'current').mockResolvedValue(decision); const login = vi.fn().mockResolvedValue(networkUser); const verified = vi.fn(); render(<NetworkSessionConfirmation user={networkUser} reauthenticate={login} onVerified={verified} onClose={vi.fn()} />); fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password ' } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' })); await waitFor(() => expect(verified).toHaveBeenCalledWith(decision)); expect(login).toHaveBeenCalledWith(networkUser.email, 'Synthetic password ', 'HMS'); expect(screen.getByLabelText('Current password')).toHaveValue('');
  });
  it('blocks Escape and repeated submits while pending, and never reads under a different account', async () => {
    let finish; const login = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; })); const current = vi.spyOn(networkApi, 'current'); const close = vi.fn(); const verified = vi.fn(); render(<NetworkSessionConfirmation user={networkUser} reauthenticate={login} onVerified={verified} onClose={close} />); fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password' } }); const submit = screen.getByRole('button', { name: 'Confirm sign-in' }); fireEvent.click(submit); fireEvent.click(submit); await screen.findByRole('button', { name: 'Confirming…' }); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled(); expect(login).toHaveBeenCalledTimes(1); await act(async () => finish({ ...networkUser, id: 'different-actor' })); await screen.findByText(/signed-in account or access scope changed/); expect(current).not.toHaveBeenCalled(); expect(verified).not.toHaveBeenCalled(); expect(screen.getByLabelText('Current password')).toHaveValue('');
  });
  it('cancels without authenticating or retaining the typed password', () => { const login = vi.fn(); const close = vi.fn(); render(<NetworkSessionConfirmation user={networkUser} reauthenticate={login} onVerified={vi.fn()} onClose={close} />); fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Synthetic password' } }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(close).toHaveBeenCalledTimes(1); expect(login).not.toHaveBeenCalled(); expect(screen.getByLabelText('Current password')).toHaveValue(''); });
});
