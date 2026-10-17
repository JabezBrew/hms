import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import AccessGrantsPage from '../AccessGrantsPage';
import { adminAccessApi } from '../api';
const user = { id: 'actor-1', email: 'synthetic@example.com', facilityCode: 'HMS', accessContext: { facility_id: 'facility-1', active_profile: 'hospital' }, adminAccess: { capabilities: ['admin.authority.manage'] } };
const grant = { id: 'grant-1', kind: 'permission_assignment', user_id: 'target-1', display_name: 'Synthetic staff', permission_code: 'admin.staff.view', position_title: null, scope_type: 'facility', status: 'active', starts_at: '2026-10-14T12:00:00Z', ends_at: null, created_at: '2026-10-14T12:00:00Z', revoked_at: null, reconciliation_required: true };
const saved = { id: grant.id, kind: grant.kind, user_id: grant.user_id, status: 'revoked', revoked_at: '2026-10-15T12:00:00Z', independent_access_retained: true, effective_permission_remaining: true };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const envelope = (rows, next = null) => ({ data: rows, page: { limit: 25, has_next: Boolean(next), next_cursor: next }, meta: {} });
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
let client; let login; let revoked; let failRefresh; let unknown;
beforeEach(() => {
  revoked = false; failRefresh = false; unknown = false;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } }); login = vi.fn().mockResolvedValue(user);
  globalThis.fetch = vi.fn(async (url, request = {}) => {
    const parsed = new URL(url);
    if (request.method === 'POST') { revoked = true; if (unknown === 'conflict') return json({ error: { code: 'access_grant_revoke_failed', message: 'The access grant could not be confirmed as revoked.' } }, 409); if (unknown) throw new Error('Lost response'); return json({ data: saved }); }
    if (revoked && failRefresh) throw new Error('Read unavailable');
    const rows = parsed.searchParams.get('cursor') ? [{ ...grant, id: 'grant-2', display_name: 'Second synthetic staff' }] : [{ ...grant, status: revoked ? 'revoked' : 'active', reconciliation_required: !revoked }];
    return json(envelope(rows, parsed.searchParams.get('cursor') ? null : 'opaque-next'));
  });
});
afterEach(() => { client.clear(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
function page(actor = user, reauthenticate) { return render(<AuthContext.Provider value={{ user: actor, login, reauthenticate }}><QueryClientProvider client={client}><MemoryRouter><AccessGrantsPage /></MemoryRouter></QueryClientProvider></AuthContext.Provider>); }
function writes() { return globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST'); }
async function openAndFill() {
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke permission assignment for Synthetic staff' }));
  fireEvent.click(screen.getByRole('radio', { name: /Retain independent access/ }));
  fireEvent.change(screen.getByLabelText('Confirm your current password'), { target: { value: 'Synthetic password' } });
}
describe('access grants through the real generated adapter', () => {
  it('confirms the existing session instead of starting another account login', async () => {
    const reauthenticate = vi.fn().mockResolvedValue(user); login.mockRejectedValue(new Error('A new login must not run'));
    page(user, reauthenticate); await openAndFill(); fireEvent.click(screen.getByRole('button', { name: 'Revoke grant' }));
    await screen.findByText('Revocation confirmed'); expect(login).not.toHaveBeenCalled();
    expect(reauthenticate).toHaveBeenCalledWith(user.email, 'Synthetic password', 'HMS', { signal: expect.any(AbortSignal) });
  });
  it('loads bounded cursor pages and clears the cursor when changing grant type', async () => {
    page(); await screen.findByText('Synthetic staff'); fireEvent.click(screen.getByRole('button', { name: 'Next' })); await screen.findByText('Second synthetic staff');
    expect(globalThis.fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('cursor') === 'opaque-next')).toBe(true);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Grant type' }), { key: 'ArrowDown' }); fireEvent.click(screen.getByRole('option', { name: 'Delegation' }));
    await screen.findByText('Synthetic staff'); expect(screen.getByText(/Page 1/)).toBeInTheDocument();
    const last = new URL(globalThis.fetch.mock.calls.at(-1)[0]); expect(last.searchParams.get('kind')).toBe('delegation'); expect(last.searchParams.get('limit')).toBe('25'); expect(last.searchParams.has('cursor')).toBe(false);
  });
  it('sends only the reviewed reconciliation and preserves saved truth across list-refresh failure', async () => {
    failRefresh = true; page(); await openAndFill(); fireEvent.click(screen.getByRole('button', { name: 'Revoke grant' }));
    await screen.findByText('Revocation confirmed'); await screen.findByText(/grant list could not refresh/);
    const [url, request] = writes()[0]; expect(new URL(url).pathname).toBe('/api/v2/admin/access-grants/permission_assignment/grant-1/revoke'); expect(JSON.parse(request.body)).toEqual({ reconciliation: 'retain_independent' }); expect(request.body).not.toContain('Synthetic password'); expect(writes()).toHaveLength(1);
    expect(within(screen.getByRole('dialog')).getByText(/Independent direct access/)).toBeInTheDocument();
  });
  it('keeps a lost-response outcome unconfirmed without automatic retry or false denial', async () => {
    unknown = true; page(); await openAndFill(); fireEvent.click(screen.getByRole('button', { name: 'Revoke grant' }));
    await screen.findByText('Revocation status unknown'); expect(writes()).toHaveLength(1); expect(screen.queryByText('Revocation confirmed')).not.toBeInTheDocument(); expect(screen.getByLabelText('Confirm your current password')).toHaveValue('');
  });
  it('treats a persisted-then-generic409 outcome as unknown and freezes the reconciliation choice', async () => {
    unknown = 'conflict'; page(); await openAndFill(); fireEvent.click(screen.getByRole('button', { name: 'Revoke grant' }));
    await screen.findByText('Revocation status unknown'); expect(writes()).toHaveLength(1);
    expect(screen.queryByText('Access not changed')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Remove the historical copy/ })).toBeDisabled();
  });
  it('denies the page before requesting data when the dedicated capability is absent', () => {
    page({ ...user, adminAccess: { capabilities: [] } }); expect(screen.getByText('Access administration unavailable')).toBeInTheDocument(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('preserves AbortError and validates persisted response identity rather than displaying malformed success', async () => {
    const abort = new DOMException('Aborted', 'AbortError'); globalThis.fetch.mockRejectedValueOnce(abort);
    await expect(adminAccessApi.list({}, { signal: new AbortController().signal })).rejects.toMatchObject({ name: 'AbortError' });
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...saved, id: 'other-grant' } })); await expect(adminAccessApi.revoke(grant.kind, grant.id)).rejects.toThrow(/did not confirm/);
  });
});
