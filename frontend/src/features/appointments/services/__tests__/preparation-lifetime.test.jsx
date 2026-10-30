import { webcrypto } from 'node:crypto';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { queryClient } from '@/lib/react-query';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/session';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { networkApi } from '@/features/settings/network/api';
import { clockNetwork, clockToken } from '@/features/auth/__tests__/clock-fixtures';
import { failure, json } from '@/features/auth/__tests__/fixtures';
import { ServiceChangeDialog } from '../components/ServiceChangeDialog';
import { actor, service } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
let user, decision, replies, requests, closed, controller, finishing, denied, bearer, sourceToken;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); queryClient.clear(); __resetV2ApiClientForTests();
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  const raw = clockToken(); bearer = raw.access_token; user = { ...structuredClone(actor), id: raw.user.id, accessContext: { ...actor.accessContext, facility_id: raw.user.facility_id } };
  configureV2ApiClient({ getAccessToken: () => bearer, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  const binding = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), readOwnerValue: JSON.stringify(user), principal: { id: user.id, facility_id: raw.user.facility_id, active_profile: 'hospital' } });
  replies = []; requests = []; closed = vi.fn(); denied = vi.fn(); finishing = false; sourceToken = service; controller = { busy: false, locked: false, error: null, unknown: false, saved: null, run: vi.fn() };
  vi.stubGlobal('fetch', vi.fn((url, request = {}) => {
    const path = new URL(url).pathname; requests.push({ path, signal: request.signal });
    if (path.endsWith('/auth/network-access')) return Promise.resolve(json(clockNetwork()));
    if (path.endsWith('/dashboard/snapshot')) return Promise.resolve(failure('permission_denied', 403));
    if (path.endsWith('/scheduling/services/' + service.id + '/administration')) return new Promise(resolve => replies.push((response = json(service)) => resolve(response)));
    return Promise.resolve(failure('synthetic_unavailable', 404));
  }));
  decision = await networkApi.current(); binding.update({ confirmed: true, decision });
});
afterEach(() => { cleanup(); queryClient.clear(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount() {
  function Host() { const [open, setOpen] = useState(true), [unavailable, setUnavailable] = useState(false); return <><button onClick={() => setOpen(true)}>Reopen review</button>{unavailable ? <p>Directory unavailable after current denial</p> : open && <ServiceChangeDialog selection={{ action: 'metadata', service }} open access={{ user, scope: 'synthetic-service-preparation', canRead: true, canManage: true, canWrite: true, canRecover: true }} controller={controller} onClose={() => { closed(); setOpen(false); }} onDenied={() => { denied(); setUnavailable(true); }} onDone={vi.fn()} finishing={finishing} sourceToken={sourceToken} />}</>; }
  const tree = () => <QueryClientProvider client={queryClient}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision }}><MemoryRouter><Host /></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function prepare() { fireEvent.click(screen.getByRole('button', { name: 'Refresh and review change' })); await waitFor(() => expect(replies.length).toBeGreaterThan(0)); }
it('clears current read preparation after real unrelated403 invalidates its lease without publishing stale review', async () => {
  mount(); await prepare(); await expect(v2Request({ path: '/api/v2/dashboard/snapshot' })).rejects.toMatchObject({ status: 403 });
  await act(async () => replies[0]());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Close review' })).toBeEnabled());
  expect(screen.queryByRole('heading', { name: 'Review exact change' })).not.toBeInTheDocument(); expect(controller.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close review' })); expect(closed).toHaveBeenCalledTimes(1);
});
it('allows closing an unsent read, aborts it and does not publish a late response after reopening', async () => {
  mount(); await prepare(); const request = requests.find(row => row.path.includes('/scheduling/services/') && row.path.endsWith('/administration'));
  expect(screen.getByRole('button', { name: 'Close review' })).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: 'Close review' })); expect(request.signal.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reopen review' })); fireEvent.click(screen.getByRole('button', { name: 'Refresh and review change' })); await waitFor(() => expect(replies).toHaveLength(2));
  await act(async () => replies[0]()); expect(screen.getByRole('button', { name: 'Confirming current service…' })).toBeDisabled(); expect(screen.queryByRole('heading', { name: 'Review exact change' })).not.toBeInTheDocument();
  await act(async () => replies[1]()); await screen.findByRole('heading', { name: 'Review exact change' }); expect(controller.run).not.toHaveBeenCalled();
});
it.each(['business-write', 'finishing'])('retains the real %s close lock', async kind => { if (kind === 'business-write') { controller.busy = true; controller.locked = true; } else finishing = true; mount(); expect(screen.getByRole('button', { name: 'Close review' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Close review' })); expect(closed).not.toHaveBeenCalled(); });

it.each([false, true])('conceals the dialog and cached fields on exact current detail403, malformed=%s', async malformed => {
  mount(); await prepare(); await act(async () => replies[0](malformed ? new Response('malformed-json', { status: 403, headers: { 'content-type': 'application/json' } }) : failure('appointment_view_denied', 403)));
  await screen.findByText('Directory unavailable after current denial'); expect(screen.queryByLabelText('Service name')).not.toBeInTheDocument(); expect(denied).toHaveBeenCalledTimes(1); expect(controller.run).not.toHaveBeenCalled();
});
it('a cancelled old403 cannot conceal fresh reopened review after a genuine transport change', async () => {
  const view = mount(); await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
  bearer = clockToken({ session: '99999999-0000-4000-8000-000000000021' }).access_token;
  const binding = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), readOwnerValue: JSON.stringify(user), principal: { id: user.id, facility_id: user.accessContext.facility_id, active_profile: 'hospital' } });
  decision = await networkApi.current(); binding.update({ confirmed: true, decision }); view.update();
  fireEvent.click(screen.getByRole('button', { name: 'Reopen review' })); fireEvent.click(screen.getByRole('button', { name: 'Refresh and review change' })); await waitFor(() => expect(replies).toHaveLength(2));
  await act(async () => replies[1]()); await screen.findByRole('heading', { name: 'Review exact change' });
  await act(async () => replies[0](failure('old_scope_denied', 403))); expect(screen.queryByText('Directory unavailable after current denial')).not.toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Review exact change' })).toBeVisible(); expect(denied).not.toHaveBeenCalled(); expect(controller.run).not.toHaveBeenCalled();
});

it('does not apply an old detail denial after a new directory source epoch is committed', async () => {
  const view = mount(); await prepare(); sourceToken = { ...service, version: 2 }; view.update();
  await act(async () => replies[0](failure('old_source_denied', 403)));
  expect(denied).not.toHaveBeenCalled(); expect(screen.queryByText('Directory unavailable after current denial')).not.toBeInTheDocument(); expect(screen.queryByRole('heading', { name: 'Review exact change' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Close review' })).toBeEnabled(); expect(controller.run).not.toHaveBeenCalled();
});
