import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/session';
import { adaptV2AuthTokenResponse } from '@/lib/api/auth';
import { providerUser } from '@/features/auth/providerUser';
import { token, json, failure, jwtFor } from '@/features/auth/__tests__/fixtures';
import { useInboxCount } from '../useInboxCount';
import CriticalAlertsMonitor from '@/components/dashboard/CriticalAlertsMonitor';
import LoginInboxToaster from '@/features/inbox/components/LoginInboxToaster';
import NotificationCenter from '@/components/layout/NotificationCenter';
import RoleDashboard from '@/features/dashboards/pages/RoleDashboard';
import { setAuthJSON, removeAuthValue } from '@/lib/auth-storage';
import { toast } from 'sonner';
import { clockToken, clockNetwork, issuerNow } from '@/features/auth/__tests__/clock-fixtures';
import { networkApi } from '@/features/settings/network/api';
import { bindNetworkAccessGuard, currentConfirmedNetworkDecision } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
vi.mock('@/hooks/useWebSocket', () => ({ useNotificationWebSocket: vi.fn() }));
vi.mock('@/components/layout/layout', () => ({ Layout: ({ children }) => <main>{children}</main> }));
vi.mock('sonner', () => { const fn = vi.fn(); fn.warning = vi.fn(); fn.info = vi.fn(); fn.error = vi.fn(); return { toast: fn }; });
vi.mock('@/shared/hooks/usePageVisibility', () => ({ usePageVisibility: () => ({ isPageActive: true }) }));
const runtime = window.__HMS_RUNTIME_CONFIG__;
let user, raw, client, paths, permitted;
beforeEach(() => {
  __resetV2ApiClientForTests(); sessionStorage.clear(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  raw = token(null, { permissions: ['appointment.view', 'appointment.manage', 'patient.demographics.view', 'system.deployment_capabilities.view'], features: ['appointments'], patient_visibility: ['demographics'] });
  user = providerUser(adaptV2AuthTokenResponse({ data: raw }), 'HMS'); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); paths = []; permitted = false;
  configureV2ApiClient({ getAccessToken: () => raw.access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(url).pathname; paths.push(path);
    if (path.endsWith('/appointments')) return json([]);
    if (!permitted) return failure('permission_denied', 403);
    if (path.endsWith('/notifications/counts')) return json({ unread: 2, action_required: 0, total: 2 });
    return json([]);
  }));
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); sessionStorage.clear(); removeAuthValue('user'); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
let latestCount;
function Count() { latestCount = useInboxCount(); return <p role="status">{latestCount.available === false ? 'Inbox unavailable' : String(latestCount.count)}</p>; }
function tree(children) { return (<QueryClientProvider client={client}><AuthContext.Provider value={{ user, facilityCode: 'HMS', isAuthenticated: true, getAccessToken: () => raw.access_token, refreshAccessToken: vi.fn() }}><MemoryRouter>{children}</MemoryRouter></AuthContext.Provider></QueryClientProvider>); }
function mount(children) { return render(tree(children)); }
it('does not mount optional Rust notification/dashboard reads for an ordinary service-only actor', async () => {
  sessionStorage.setItem('hms.pendingLoginToast', '1'); mount(<><Count /><CriticalAlertsMonitor /><LoginInboxToaster /></>);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
  expect(paths).toEqual([]); expect(screen.getByRole('status')).toHaveTextContent('Inbox unavailable');
});
it('ordinary deployment-capability read alone does not classify its actor as an administrator', () => { expect(user.role).toBe('doctor'); });
it.each(['notification.view', 'dashboards'])('does not offer a notification count when %s alone is supplied', async value => {
  user.adminAccess.capabilities = [value === 'notification.view' ? value : 'patient.demographics.view']; user.accessContext.features = value === 'dashboards' ? [value] : ['appointments']; mount(<Count />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); expect(paths).toEqual([]); expect(screen.getByRole('status')).toHaveTextContent('Inbox unavailable');
});
it('reads a real authorized Rust count only when both current notification permission and dashboards feature exist', async () => {
  permitted = true; user.adminAccess.capabilities.push('notification.view'); user.accessContext.features.push('dashboards'); mount(<Count />);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2')); expect(paths).toEqual(['/api/v2/notifications/counts']);
});
it.each(['admin.staff.manage', 'system.ops.view'])('preserves actual privileged compatibility classification for %s', permission => {
  const value = token(null, { permissions: [permission] }); expect(providerUser(adaptV2AuthTokenResponse({ data: value }), 'HMS').role).toBe('admin');
});

const pause = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
function grantNotifications() { user.adminAccess.capabilities.push('notification.view'); user.accessContext.features.push('dashboards'); }
function Location() { return <p data-testid="location">{useLocation().pathname}</p>; }
it('withholds a cached authorized count immediately after capability loss and isolates its authorization key', async () => {
  permitted = true; grantNotifications(); const view = mount(<Count />);
  await waitFor(() => expect(latestCount.count).toBe(2));
  const oldKey = client.getQueryCache().getAll()[0].queryKey;
  user = { ...user, adminAccess: { ...user.adminAccess, capabilities: ['patient.demographics.view'] } };
  view.rerender(tree(<Count />));
  expect(latestCount).toEqual({ count: null, unreadCount: null, pendingCount: null, available: false });
  await pause(); expect(paths).toEqual(['/api/v2/notifications/counts']);
  expect(JSON.stringify(oldKey)).not.toContain(raw.access_token);
  expect(JSON.stringify(oldKey)).not.toContain(user.id);
  expect(client.getQueryCache().getAll().some(q => JSON.stringify(q.queryKey) !== JSON.stringify(oldKey))).toBe(true);
});
it('keeps an actual denied Rust count unavailable, including after a previous successful value', async () => {
  permitted = true; grantNotifications(); mount(<Count />); await waitFor(() => expect(latestCount.count).toBe(2));
  permitted = false;
  await act(async () => { await client.invalidateQueries({ queryKey: ['inbox'] }); });
  await waitFor(() => expect(latestCount.available).toBe(false));
  expect(latestCount.count).toBeNull(); expect(paths).toEqual(['/api/v2/notifications/counts', '/api/v2/notifications/counts']);
  expect(client.getQueryCache().getAll()[0].state.status).toBe('error');
});
it('does not toast cached unread rows after capability loss', async () => {
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
  permitted = true; grantNotifications();
  vi.mocked(fetch).mockImplementation(async url => { paths.push(new URL(url).pathname); return json([{ id: 'synthetic-optional-notification', notification_type: 'referral.submitted', title: 'Synthetic urgent update', priority: 'urgent', created_at: '2026-10-30T00:00:00Z' }]); });
  sessionStorage.setItem('hms.pendingLoginToast', '1'); const view = mount(<LoginInboxToaster />);
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
  view.unmount(); expect(client.getQueryCache().getAll().some(q => q.state.data?.results?.length === 1)).toBe(true); toast.mockClear(); toast.warning.mockClear();
  user = { ...user, adminAccess: { ...user.adminAccess, capabilities: [] } };
  sessionStorage.setItem('hms.pendingLoginToast', '1'); mount(<LoginInboxToaster />); await pause();
  expect(toast).not.toHaveBeenCalled(); expect(toast.warning).not.toHaveBeenCalled(); expect(paths).toEqual(['/api/v2/notifications']);
});
it('offers an unavailable bell without making requests when the actual grants are absent', async () => {
  user.adminAccess.capabilities = ['patient.demographics.view']; mount(<NotificationCenter />); await pause();
  expect(paths).toEqual([]); fireEvent.click(screen.getByRole('button', { name: 'Notifications unavailable' }));
  expect(await screen.findByText('Notifications unavailable with your current access.')).toBeVisible();
  expect(screen.queryByText('No notifications')).not.toBeInTheDocument();
});
it('keeps the authorized appointment preview while withholding notification reads for a service-only doctor', async () => {
  setAuthJSON('user', user); mount(<NotificationCenter />); await pause();
  expect(paths).toEqual(['/api/v2/appointments']); expect(screen.getByRole('button', { name: 'Notifications unavailable' })).toBeInTheDocument();
});
it('runs authorized notification preview requests and does not turn a denied unread count into zero availability', async () => {
  grantNotifications(); setAuthJSON('user', user);
  vi.mocked(fetch).mockImplementation(async url => {
    const parsed = new URL(url); paths.push(parsed.pathname);
    return parsed.searchParams.get('unread_only') ? failure('permission_denied', 403) : json([]);
  });
  mount(<NotificationCenter />); await waitFor(() => expect(paths).toHaveLength(3));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications unavailable' })).toBeInTheDocument());
  expect(client.getQueryCache().getAll().some(q => q.queryKey[0] === 'referralNotificationCount' && q.state.status === 'error')).toBe(true);
});
it.each(['dashboard.view', 'dashboards'])('does not mount an admin snapshot monitor with only %s', async value => {
  user.role = 'admin'; user.adminAccess.capabilities = value === 'dashboard.view' ? [value] : [];
  user.accessContext.features = value === 'dashboards' ? [value] : [];
  mount(<CriticalAlertsMonitor />); await pause(); expect(paths).toEqual([]);
});
it('loads the admin monitor snapshot when the actual capability and feature both exist', async () => {
  permitted = true; user.role = 'admin'; user.adminAccess.capabilities.push('dashboard.view'); user.accessContext.features.push('dashboards');
  mount(<CriticalAlertsMonitor />); await waitFor(() => expect(paths).toEqual(['/api/v2/dashboards/snapshot']));
});
const inpatientPermissions = ['ward.view', 'admission.manage', 'nursing.task.manage'];
const inpatientFeatures = ['wards', 'admissions', 'nursing'];
it.each([...inpatientPermissions, ...inpatientFeatures, 'patient.demographics.view', 'demographics'])('withholds the doctor inpatient preview if %s is absent', async missing => {
  user.role = 'doctor'; user.adminAccess.capabilities = [...inpatientPermissions, 'patient.demographics.view'].filter(p => p !== missing);
  user.accessContext.features = inpatientFeatures.filter(f => f !== missing); user.accessContext.patient_visibility = missing === 'demographics' ? [] : ['demographics'];
  mount(<CriticalAlertsMonitor />); await pause(); expect(paths).toEqual([]);
});
it('loads all three inpatient preview requests only with the complete current grants', async () => {
  permitted = true; user.role = 'doctor'; user.adminAccess.capabilities.push(...inpatientPermissions); user.accessContext.features.push(...inpatientFeatures);
  mount(<CriticalAlertsMonitor />); await waitFor(() => expect(paths).toHaveLength(3));
  expect(paths.sort()).toEqual(['/api/v2/discharges', '/api/v2/nursing/tasks', '/api/v2/wards/board']);
});
it('does not render the default admin dashboard without current snapshot grants', async () => {
  user.role = 'admin'; mount(<RoleDashboard />); await pause();
  expect(screen.getByRole('heading', { name: 'Dashboard unavailable' })).toBeInTheDocument(); expect(paths).toEqual([]);
});
it('preserves the doctor My Work redirect with appointment authority and without dashboard permission or feature', async () => {
  permitted = true; mount(<><RoleDashboard /><Location /></>);
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/my-work'));
  expect(paths).not.toContain('/api/v2/dashboards/snapshot');
});
it('preserves legacy count reads and zero defaults without requiring Rust grants', async () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' };
  vi.mocked(fetch).mockImplementation(async url => { paths.push(new URL(url, 'http://localhost').pathname); return new Response(JSON.stringify({ unread: 3, action_required: 1, total: 4 }), { status: 200, headers: { 'content-type': 'application/json' } }); });
  mount(<Count />); expect(latestCount.count).toBe(0); await waitFor(() => expect(latestCount.count).toBe(4));
  expect(latestCount.available).toBe(true); expect(paths).toEqual(['/api/notifications/inbox/counts/']);
});


// These controls obtain clock provenance through actual networkApi/current ->
// generated client -> v2Request, then bind that validated decision to its owner.
async function installRealOptionalNetwork(changedActor = false) {
  const permissions = [...user.adminAccess.capabilities], features = [...user.accessContext.features];
  raw = clockToken({ session: changedActor ? '99999999-0000-4000-8000-000000000021' : undefined });
  raw.user.permissions = permissions; raw.user.features = features; raw.user.patient_visibility = ['demographics'];
  if (changedActor) {
    raw.user.id = '99999999-0000-4000-8000-000000000009';
    raw.access_token = jwtFor(raw, { iat: issuerNow / 1000, auth_time: issuerNow / 1000 - 120, exp: issuerNow / 1000 + 600, session_id: '99999999-0000-4000-8000-000000000021' });
  }
  user = providerUser(adaptV2AuthTokenResponse({ data: raw }), 'HMS');
  configureV2ApiClient({ getAccessToken: () => raw.access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  const binding = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), principal: { id: user.id, facility_id: raw.user.facility_id, active_profile: raw.user.active_profile, session_version: raw.user.session_version, permission_version: raw.user.permission_version } });
  binding.update({ confirmed: true, decision: await networkApi.current() });
  expect(currentOptionalNetwork()).not.toBeNull(); return binding;
}
function currentOptionalNetwork() { return currentConfirmedNetworkDecision(getV2ClientScopeKey(), authorizationIdentity(user)); }
async function refreshRealOptionalNetwork(binding) { await act(async () => { binding.update({ confirmed: true, decision: await networkApi.current() }); }); expect(currentOptionalNetwork()).not.toBeNull(); }
const notificationRow = title => ({ id: '99999999-0000-4000-8000-000000000070', notification_type: 'referral.submitted', title, body: 'Synthetic referral preview', priority: 'normal', read_at: null, created_at: '2026-10-18T10:01:00Z' });

it('real current count403 invalidates its network clock and fresh same-owner clock cannot revive denied cached count before an authorized read', async () => {
  grantNotifications(); let denied = false, pending = null, refreshPending = false;
  vi.mocked(fetch).mockImplementation(async url => {
    const path = new URL(url).pathname; paths.push(path);
    if (path.endsWith('/auth/network-access')) return json(clockNetwork());
    if (path.endsWith('/notifications/counts')) {
      if (refreshPending) return new Promise(resolve => { pending = resolve; });
      return denied ? failure('notification_view_denied', 403) : json({ unread: 2, action_required: 0, total: 2 });
    }
    return failure('unexpected_optional_request', 404);
  });
  const binding = await installRealOptionalNetwork(); mount(<Count />); await waitFor(() => expect(latestCount.count).toBe(2));
  denied = true; await act(async () => { await client.invalidateQueries({ queryKey: ['inbox'] }); });
  await waitFor(() => expect(latestCount.available).toBe(false)); expect(currentOptionalNetwork()).toBeNull();
  const query = client.getQueryCache().getAll().find(q => q.queryKey[0] === 'inbox'); expect(query.state.data.total).toBe(2); expect(query.state.status).toBe('error');
  await refreshRealOptionalNetwork(binding); expect(latestCount.available).toBe(false); expect(latestCount.count).toBeNull();
  denied = false; refreshPending = true; let refresh;
  await act(async () => { refresh = client.invalidateQueries({ queryKey: ['inbox'] }); });
  await waitFor(() => expect(pending).not.toBeNull()); expect(latestCount.available).toBe(false);
  await act(async () => { pending(json({ unread: 5, action_required: 0, total: 5 })); await refresh; });
  await waitFor(() => expect(latestCount.count).toBe(5)); expect(latestCount.available).toBe(true);
});

it('real current notification list403 withholds cached rows through fresh clock observation until a fresh authorized row response', async () => {
  grantNotifications(); let denied = false, fresh = false, pending = null;
  vi.mocked(fetch).mockImplementation(async url => {
    const parsed = new URL(url); paths.push(parsed.pathname);
    if (parsed.pathname.endsWith('/auth/network-access')) return json(clockNetwork());
    if (parsed.pathname.endsWith('/appointments')) return json([]);
    if (parsed.pathname.endsWith('/notifications') && parsed.searchParams.get('unread_only')) return json([]);
    if (parsed.pathname.endsWith('/notifications')) {
      if (fresh) return new Promise(resolve => { pending = resolve; });
      return denied ? failure('notification_view_denied', 403) : json([notificationRow('Synthetic cached row')]);
    }
    return failure('unexpected_optional_request', 404);
  });
  const binding = await installRealOptionalNetwork(); setAuthJSON('user', user); mount(<NotificationCenter />);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' })); await screen.findByText(/Synthetic cached row/);
  denied = true; await act(async () => { await client.invalidateQueries({ queryKey: ['referralNotifications'] }); });
  await waitFor(() => expect(screen.queryByText(/Synthetic cached row/)).not.toBeInTheDocument()); expect(currentOptionalNetwork()).toBeNull();
  const query = client.getQueryCache().getAll().find(q => q.queryKey[0] === 'referralNotifications'); expect(query.state.data[0].referral_number).toBe('Synthetic cached row'); expect(query.state.status).toBe('error');
  await refreshRealOptionalNetwork(binding); expect(screen.queryByText(/Synthetic cached row/)).not.toBeInTheDocument();
  expect(screen.getByText('Notifications unavailable with your current access.')).toBeVisible();
  denied = false; fresh = true; let refresh;
  await act(async () => { refresh = client.invalidateQueries({ queryKey: ['referralNotifications'] }); });
  await waitFor(() => expect(pending).not.toBeNull()); expect(screen.queryByText(/Synthetic cached row/)).not.toBeInTheDocument();
  await act(async () => { pending(json([notificationRow('Synthetic freshly authorized row')])); await refresh; });
  await screen.findByText(/Synthetic freshly authorized row/); expect(screen.queryByText('Notifications unavailable with your current access.')).not.toBeInTheDocument();
});

it('a late old actor count403 cannot hide the new actor authorized count or invalidate its real network clock', async () => {
  grantNotifications(); let oldPending = null, deferOld = false, freshActor = false;
  vi.mocked(fetch).mockImplementation(async url => {
    const path = new URL(url).pathname; paths.push(path);
    if (path.endsWith('/auth/network-access')) return json(clockNetwork());
    if (path.endsWith('/notifications/counts')) {
      if (deferOld && !freshActor) return new Promise(resolve => { oldPending = resolve; });
      return json({ unread: freshActor ? 8 : 2, action_required: 0, total: freshActor ? 8 : 2 });
    }
    return failure('unexpected_optional_request', 404);
  });
  await installRealOptionalNetwork(); const oldView = mount(<Count />); await waitFor(() => expect(latestCount.count).toBe(2));
  deferOld = true; let oldRefresh; await act(async () => { oldRefresh = client.invalidateQueries({ queryKey: ['inbox'] }); });
  await waitFor(() => expect(oldPending).not.toBeNull()); const oldActor = user.id; oldView.unmount(); freshActor = true;
  await installRealOptionalNetwork(true); expect(user.id).not.toBe(oldActor); mount(<Count />); await waitFor(() => expect(latestCount.count).toBe(8));
  await act(async () => { oldPending(failure('old_actor_denied', 403)); await oldRefresh; });
  expect(latestCount.count).toBe(8); expect(latestCount.available).toBe(true); expect(currentOptionalNetwork()).not.toBeNull();
});

it('a cancelled old request403 cannot hide a newer authorized count for the same actor and real network clock', async () => {
  grantNotifications(); let pending = null, deferOld = false, fresh = false;
  vi.mocked(fetch).mockImplementation(async url => {
    const path = new URL(url).pathname; paths.push(path);
    if (path.endsWith('/auth/network-access')) return json(clockNetwork());
    if (path.endsWith('/notifications/counts')) {
      if (deferOld && !fresh) return new Promise(resolve => { pending = resolve; });
      return json({ unread: fresh ? 6 : 2, action_required: 0, total: fresh ? 6 : 2 });
    }
    return failure('unexpected_optional_request', 404);
  });
  await installRealOptionalNetwork(); mount(<Count />); await waitFor(() => expect(latestCount.count).toBe(2));
  deferOld = true; let oldRefresh; await act(async () => { oldRefresh = client.invalidateQueries({ queryKey: ['inbox'] }); });
  await waitFor(() => expect(pending).not.toBeNull()); await act(async () => { await client.cancelQueries({ queryKey: ['inbox'] }); });
  fresh = true; await act(async () => { await client.invalidateQueries({ queryKey: ['inbox'] }); }); await waitFor(() => expect(latestCount.count).toBe(6));
  await act(async () => { pending(failure('cancelled_old_request_denied', 403)); await oldRefresh; });
  expect(latestCount.count).toBe(6); expect(latestCount.available).toBe(true); expect(currentOptionalNetwork()).not.toBeNull();
});
