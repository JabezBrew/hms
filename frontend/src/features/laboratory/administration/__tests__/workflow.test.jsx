import { Suspense } from 'react';
// Component/HTTP-boundary coverage. No real authentication,
// native database, browser keyboard or rendered viewport acceptance is implied.
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Api } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { authorizationIdentity, requestAuthorizationScope } from '@/shared/lib/authorizationScope';
import { networkApi } from '@/features/settings/network/api';
import { networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { useCatalogAccess } from '../useCatalogAccess';
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { subscribeServerClockDenials } from '@/shared/lib/serverClock';
import { clockToken, clockNetwork } from '@/features/auth/__tests__/clock-fixtures';
import { featureRoutes } from '@/app/routes/featureRoutes';
import { renderRoutes } from '@/app/routes/renderRoutes';
import { ROUTE_LAYOUTS, SIDEBARS } from '@/app/routes/routeTypes';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/layout/sidebar';
import LabCatalogAdministrationPage from '../LabCatalogAdministrationPage';
import { ids, testId, panelId, subject, input, result, listItem, page, manager } from './fixtures';
vi.mock('@/features/inbox/hooks', () => ({ useInboxCount: () => ({ count: 0 }) }));
// Production loads runtime-config before the entry module and navigation graph.
const boot = vi.hoisted(() => {
  const runtime = window.__HMS_RUNTIME_CONFIG__;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  return { runtime };
});
const runtime = boot.runtime;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const reply = value => json({ data: value, meta: {} });
let user, client, decision, current, writes, receipts, writeMode, detailMode, receiptMode, pending, holdNetwork, networkPending, currentPublisher;
async function establish() {
  const principal = { id: user.id, facility_id: user.accessContext.facility_id, active_profile: user.accessContext.active_profile }, transport = getV2ClientScopeKey(), authority = authorizationIdentity(user);
  const binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal, readOwnerValue: JSON.stringify(principal) }); activateWriteUncertainty(principal, { authority, transport });
  decision = await networkApi.current(); binding.update({ confirmed: true, decision });
}
beforeEach(async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  const token = clockToken({ ordinary: true }); configureV2ApiClient({ getAccessToken: () => token.access_token, getFacilityCode: () => 'QA27', canRefreshSession: () => false });
  user = manager(); current = { test: subject(), panel: subject('panel') }; writes = []; receipts = new Map(); writeMode = 'ok'; detailMode = 'ok'; receiptMode = 'ok'; pending = []; holdNetwork = false; networkPending = []; currentPublisher = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 3 } } });
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const address = new URL(url), path = address.pathname, kind = /panel-administration|\/panels\//.test(path) ? 'panel' : 'test';
    if (path.endsWith('/auth/network-access')) return holdNetwork ? new Promise(resolve => networkPending.push(() => resolve(reply(clockNetwork())))) : reply(clockNetwork());
    if (path.endsWith('/system/deployment-capabilities')) return json({ error: { code: 'forbidden' } }, 403);
    if (options.method === 'POST') {
      const wire = JSON.parse(options.body); writes.push({ path, wire });
      const previous = current[kind], recorded = await result({ ...input(previous), ...wire }, previous); receipts.set(wire.client_request_id, recorded.receipt); current[kind] = recorded.receipt.subject;
      if (writeMode === 'lost') throw new TypeError('Synthetic committed reply loss');
      if (writeMode === 'pending') return new Promise(resolve => pending.push(() => resolve(reply(recorded.receipt))));
      if (writeMode === 'unconfirmed409') return json({ error: { code: 'laboratory_catalog_write_unconfirmed' } }, 409);
      return reply(recorded.receipt);
    }
    if (path.includes('/catalog-commands/')) {
      if (receiptMode === 'denied') return json({ error: { code: 'forbidden' } }, 403);
      const original = receipts.get(path.split('/').at(-1)); return original ? reply(original) : json({ error: { code: 'not_found' } }, 404);
    }
    if (/\/(?:test|panel)-administration$/.test(path)) {
      const row = listItem(current[kind]);
      if (address.searchParams.get('cursor')) row.id = ids[10];
      return json(page([row], address.searchParams.get('cursor') ? null : 'opaque-page-2'));
    }
    if (path.endsWith('/history')) return json(page([]));
    if (path.endsWith('/administration')) {
      if (detailMode === 'pending') return new Promise(resolve => pending.push(value => resolve(value || reply(current[kind]))));
      if (detailMode === 'denied') return json({ error: { code: 'forbidden' } }, 403);
      return reply(current[kind]);
    }
    return json({ error: { code: 'unexpected_synthetic_route' } }, 404);
  }));
  await establish(); fetch.mockClear();
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function CatalogReadinessProbe() {
  const access = useCatalogAccess();
  currentPublisher = useScopedNotifications('clock-denial-probe');
  return <output aria-label="Current catalog readiness">{access.readReady ? 'ready' : 'blocked'}</output>;
}
function mount(path = '/laboratory/catalog-administration/tests', composite = false, probe = false, authoritative = false) {
  const route = featureRoutes.find(row => row.path === '/laboratory/catalog-administration/*');
  const authoritativeTree = () => <AuthContext.Provider value={{ user, isAuthenticated: true, sessionReady: true }}><QueryClientProvider client={client}><HelmetProvider><MemoryRouter initialEntries={[path]}><NetworkAccessBoundary><BreadcrumbProvider>{probe && <CatalogReadinessProbe />}<Suspense fallback={<p>Loading lab workspace</p>}><Routes><Route path="/laboratory/catalog-administration/*" element={<LabCatalogAdministrationPage />} /></Routes></Suspense></BreadcrumbProvider></NetworkAccessBoundary></MemoryRouter></HelmetProvider></QueryClientProvider></AuthContext.Provider>;
  const tree = () => <AuthContext.Provider value={{ user, isAuthenticated: true }}><QueryClientProvider client={client}><ReadOnlyModeProvider network={{ confirmed: true, decision }}><HelmetProvider><MemoryRouter initialEntries={[path]}><BreadcrumbProvider>{probe && <CatalogReadinessProbe />}{composite && <SidebarProvider><AppSidebar sidebar={SIDEBARS.LABORATORY} /></SidebarProvider>}<Suspense fallback={<p>Loading lab workspace</p>}><Routes>{composite ? renderRoutes([{ ...route, layout: ROUTE_LAYOUTS.BARE }]) : <Route path="/laboratory/catalog-administration/*" element={<LabCatalogAdministrationPage />} />}<Route path="/feature-unavailable" element={<p>Unexpected global feature denial</p>} /><Route path="/unauthorized" element={<p>Current route authority unavailable</p>} /></Routes></Suspense></BreadcrumbProvider></MemoryRouter></HelmetProvider></ReadOnlyModeProvider></QueryClientProvider></AuthContext.Provider>;
  const content = () => authoritative ? authoritativeTree() : tree();
  const view = render(content()); return { ...view, update: () => view.rerender(content()) };
}
async function openReview() {
  const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Review availability' })); fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  Synthetic reviewed reason  ' } });
  await ev.click(screen.getByRole('button', { name: 'Refresh and review availability' })); await ev.click(await screen.findByLabelText('I reviewed this exact availability change')); return ev;
}
it.each(['test', 'panel'])('renders sole-manager no-patient %s administration without a clinical catalog read or mount write', async kind => {
  mount(`/laboratory/catalog-administration/${kind === 'test' ? 'tests' : 'panels'}/${kind === 'test' ? testId : panelId}`); await screen.findByRole('heading', { name: 'Availability history' });
  expect(writes).toHaveLength(0); expect(screen.queryByText(/price|turnaround/i)).not.toBeInTheDocument();
  expect(fetch.mock.calls.every(([url]) => /\/(administration|history)$/.test(new URL(url).pathname))).toBe(true);
});
it('denies an orderer/admin role without catalog authority before issuing requests', () => {
  user.role = 'admin'; user.adminAccess.capabilities = ['laboratory.order.manage', 'patient.demographics.view']; mount(); expect(screen.getByRole('heading', { name: 'Catalog administration unavailable' })).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
it('uses server cursors and resets them on explicit literal search rather than loading all rows', async () => {
  mount(); const ev = userEvent.setup(); await screen.findByRole('grid'); await ev.click(screen.getByRole('button', { name: 'Next page' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled());
  expect(new URL(fetch.mock.calls.at(-1)[0]).searchParams.get('cursor')).toBe('opaque-page-2'); fireEvent.change(screen.getByLabelText('Code or name'), { target: { value: 'Synthetic_% literal' } }); await ev.click(screen.getByRole('button', { name: 'Search definitions' })); await waitFor(() => expect(new URL(fetch.mock.calls.at(-1)[0]).searchParams.get('search')).toBe('Synthetic_% literal')); expect(new URL(fetch.mock.calls.at(-1)[0]).searchParams.has('cursor')).toBe(false); expect(writes).toHaveLength(0);
});
it.each(['footer', 'Escape', 'close icon'])('returns focus to the exact connected opener after unsent %s cancellation', async method => {
  mount(`/laboratory/catalog-administration/tests/${testId}`); const ev = userEvent.setup(), opener = await screen.findByRole('button', { name: 'Review availability' }); await ev.click(opener);
  if (method === 'footer') await ev.click(screen.getByRole('button', { name: 'Close availability review' })); else if (method === 'Escape') await ev.keyboard('{Escape}'); else await ev.click(screen.getByRole('button', { name: 'Close', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await waitFor(() => expect(opener).toHaveFocus()); expect(writes).toHaveLength(0);
});
it('requires separate exact consent, clears it on input change, and latches one POST while dismissal is locked', async () => {
  mount(`/laboratory/catalog-administration/tests/${testId}`); const ev = await openReview(); fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Different reviewed reason' } }); expect(screen.queryByLabelText('I reviewed this exact availability change')).not.toBeInTheDocument();
  await ev.click(screen.getByRole('button', { name: 'Refresh and review availability' })); await ev.click(await screen.findByLabelText('I reviewed this exact availability change')); writeMode = 'pending';
  const submit = screen.getByRole('button', { name: 'Confirm reviewed availability' }); fireEvent.click(submit); fireEvent.click(submit); await waitFor(() => expect(writes).toHaveLength(1)); expect(screen.getByRole('button', { name: 'Close availability review' })).toBeDisabled();
  await act(async () => pending[0]()); await screen.findByText('Original availability result confirmed'); expect(writes[0].wire).toEqual({ client_request_id: expect.any(String), expected_version: 1, is_active: false, reason: 'Different reviewed reason' });
});
it.each(['lost', 'unconfirmed409'])('keeps %s unknown across navigation and recovers the original without a secondPOST after later state', async mode => {
  mount(`/laboratory/catalog-administration/tests/${testId}`); const ev = await openReview(); writeMode = mode; await ev.click(screen.getByRole('button', { name: 'Confirm reviewed availability' })); await screen.findByText('Availability change needs reconciliation'); expect(writes).toHaveLength(1);
  current.test = subject('test', { version: 5 }); await ev.click(screen.getByRole('button', { name: 'Close availability review' })); await ev.click(screen.getByRole('button', { name: 'Back to definitions' })); await screen.findByRole('grid'); await ev.click(screen.getByRole('button', { name: 'Review pending availability change' })); await ev.click(screen.getByRole('button', { name: 'Check original availability result' })); await screen.findByText('Original availability result confirmed'); expect(writes).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('cancels source preparation and discards its late response after close', async () => {
  mount(`/laboratory/catalog-administration/tests/${testId}`); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Review availability' })); fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic reason' } }); detailMode = 'pending'; await ev.click(screen.getByRole('button', { name: 'Refresh and review availability' })); await waitFor(() => expect(pending).toHaveLength(1)); const oldSignal = fetch.mock.calls.at(-1)[1].signal;
  await ev.click(screen.getByRole('button', { name: 'Close availability review' })); expect(oldSignal.aborted).toBe(true); await act(async () => pending[0]()); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('hides current detail and copied review after an actual targeted source denial', async () => {
  mount(`/laboratory/catalog-administration/tests/${testId}`); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Review availability' })); fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic copied reason' } }); detailMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Refresh and review availability' })); await screen.findByRole('heading', { name: 'Catalog administration unavailable' }); expect(screen.queryByDisplayValue('Synthetic copied reason')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('discards copied intent on committed actorA→B→A and never revives the old preparation callback', async () => {
  const view = mount(`/laboratory/catalog-administration/tests/${testId}`), ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Review availability' })); detailMode = 'pending'; await ev.click(screen.getByRole('button', { name: 'Refresh and review availability' })); await waitFor(() => expect(pending).toHaveLength(1)); const old = pending[0], original = structuredClone(user);
  detailMode = 'ok'; user = { ...user, id: ids[8] }; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Review availability' }); user = original; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Review availability' }); await act(async () => old()); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});

it('reaches actual composite route/FeatureBasedRoute and sidebar with sole grant after a real denied global metadata read', async () => {
  await client.fetchQuery({ queryKey: ['system', 'deployment-capabilities', requestAuthorizationScope(user, getV2ClientScopeKey())], queryFn: () => v2Api.getSystemDeploymentCapabilities(), retry: false }).catch(() => {});
  await establish(); const deniedRequests = fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/system/deployment-capabilities')).length; expect(deniedRequests).toBe(1);
  mount(`/laboratory/catalog-administration/tests/${testId}`, true); await screen.findByRole('heading', { name: 'Availability history' }); expect(screen.getByRole('link', { name: 'Catalog administration' })).toBeInTheDocument(); expect(screen.queryByText('Unexpected global feature denial')).not.toBeInTheDocument();
  const ev = await openReview(); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed availability' })); await screen.findByText('Original availability result confirmed'); expect(writes).toHaveLength(1); expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/system/deployment-capabilities'))).toHaveLength(1);
});
it.each(['capability', 'feature'])('removes composite route/sidebar protected content when current %s is revoked', async field => {
  const view = mount(`/laboratory/catalog-administration/tests/${testId}`, true); await screen.findByRole('button', { name: 'Review availability' });
  if (field === 'capability') user = { ...user, adminAccess: { capabilities: [] }, accessContext: { ...user.accessContext, permission_version: 2 } };
  else user = { ...user, accessContext: { ...user.accessContext, features: [] } };
  view.update(); await screen.findByText(field === 'capability' ? 'Current route authority unavailable' : 'Catalog administration unavailable'); expect(screen.queryByRole('link', { name: 'Catalog administration' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Review availability' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});

it('reactively masks retained catalog readiness and exact review after an unrelated real403 without changing provider input', async () => {
  const view = mount(`/laboratory/catalog-administration/tests/${testId}`, false, true);
  await screen.findByRole('heading', { name: 'Availability history' });
  const ev = await openReview();
  expect(screen.getByLabelText('Current catalog readiness')).toHaveTextContent('ready');
  expect(screen.getByRole('button', { name: 'Confirm reviewed availability' })).toBeEnabled();
  const originalDecision = decision, originalLease = currentPublisher();
  expect(originalLease.isCurrent()).toBe(true);
  await act(async () => { await expect(v2Api.getSystemDeploymentCapabilities()).rejects.toMatchObject({ status: 403 }); });
  expect(decision).toBe(originalDecision);
  expect(networkClockCurrent(originalDecision)).toBe(false);
  expect(originalLease.isCurrent()).toBe(false);
  await waitFor(() => expect(screen.getByLabelText('Current catalog readiness')).toHaveTextContent('blocked'));
  expect(screen.queryByRole('heading', { name: 'Availability history', hidden: true })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('I reviewed this exact availability change')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm reviewed availability' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh and review availability' })).toBeDisabled();
  expect(writes).toHaveLength(0);
  view.update();
  expect(screen.getByLabelText('Current catalog readiness')).toHaveTextContent('blocked');
  expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/auth/network-access'))).toHaveLength(0);
  await act(async () => { await establish(); view.update(); });
  await ev.click(screen.getByRole('button', { name: 'Close availability review' }));
  await screen.findByRole('heading', { name: 'Availability history' });
  expect(networkClockCurrent(decision)).toBe(true);
  expect(decision).not.toBe(originalDecision);
  expect(originalLease.isCurrent()).toBe(false);
  expect(currentPublisher().isCurrent()).toBe(true);
  expect(screen.getByLabelText('Current catalog readiness')).toHaveTextContent('ready');
  expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/auth/network-access'))).toHaveLength(1);
  expect(screen.queryByLabelText('I reviewed this exact availability change')).not.toBeInTheDocument();
  await ev.click(screen.getByRole('button', { name: 'Review availability' }));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic fresh review after denial' } });
  await ev.click(screen.getByRole('button', { name: 'Refresh and review availability' }));
  expect(await screen.findByLabelText('I reviewed this exact availability change')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Confirm reviewed availability' })).toBeDisabled();
  expect(writes).toHaveLength(0);
});
it('keeps a preparation started before unrelated403 invalid after a genuine fresh network observation restores readiness', async () => {
  const view = mount(`/laboratory/catalog-administration/tests/${testId}`, false, true), ev = userEvent.setup();
  await ev.click(await screen.findByRole('button', { name: 'Review availability' }));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic old preparation' } });
  detailMode = 'pending'; await ev.click(screen.getByRole('button', { name: 'Refresh and review availability' }));
  await waitFor(() => expect(pending).toHaveLength(1)); const old = pending[0];
  await act(async () => { await expect(v2Api.getSystemDeploymentCapabilities()).rejects.toMatchObject({ status: 403 }); });
  await waitFor(() => expect(screen.getByLabelText('Current catalog readiness')).toHaveTextContent('blocked'));
  detailMode = 'ok'; await act(async () => { await establish(); view.update(); });
  await waitFor(() => expect(screen.getByLabelText('Current catalog readiness')).toHaveTextContent('ready'));
  await act(async () => old());
  expect(screen.queryByLabelText('I reviewed this exact availability change')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Confirm reviewed availability' })).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it('preserves a current target403 terminal denial across the actual boundary held-network recheck', async () => {
  mount(`/laboratory/catalog-administration/tests/${testId}`, false, true, true);
  const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Review availability' }));
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Synthetic target denial reason' } });
  holdNetwork = true; detailMode = 'denied';
  await ev.click(screen.getByRole('button', { name: 'Refresh and review availability' }));
  await waitFor(() => expect(networkPending.length).toBeGreaterThan(0));
  expect(screen.queryByRole('button', { name: 'Review availability' })).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
  // Release only the real request already dispatched; any unintended denial
  // loop stays held instead of manufacturing repeated confirmation traffic.
  await act(async () => { networkPending.splice(0).forEach(release => release()); });
  await screen.findByRole('heading', { name: 'Catalog administration unavailable' });
  expect(screen.queryByRole('button', { name: 'Review availability' })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Synthetic target denial reason')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('I reviewed this exact availability change')).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it('isolates a failing denial subscriber without interrupting real403 handling or later readiness subscribers', async () => {
  const unsubscribe = subscribeServerClockDenials(() => { throw new Error('Synthetic notification subscriber failure'); });
  try {
    mount(`/laboratory/catalog-administration/tests/${testId}`, false, true);
    await screen.findByRole('heading', { name: 'Availability history' });
    expect(screen.getByLabelText('Current catalog readiness')).toHaveTextContent('ready');
    await act(async () => { await expect(v2Api.getSystemDeploymentCapabilities()).rejects.toMatchObject({ status: 403 }); });
    await waitFor(() => expect(screen.getByLabelText('Current catalog readiness')).toHaveTextContent('blocked'));
    expect(writes).toHaveLength(0);
  } finally { unsubscribe(); }
});
