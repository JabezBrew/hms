import { webcrypto } from 'node:crypto';
import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard, networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { clockNetwork, clockToken, issuerNow } from '@/features/auth/__tests__/clock-fixtures';
import { jwtFor, json, failure } from '@/features/auth/__tests__/fixtures';
import { networkApi } from '../api';
import { WriteRecoveryNotice } from '../WriteRecoveryNotice';
import { restrictExpiredDecision, useNetworkDecisionExpired } from '../useNetworkDecisionExpired';
import { storageLocationApi } from '@/features/inventory/locations/api';
import { useStorageLocationAccess } from '@/features/inventory/locations/useStorageLocationAccess';
import { StorageLocationChangeDialog } from '@/features/inventory/locations/components/StorageLocationChangeDialog';
import { StorageLocationReloadRecovery } from '@/features/inventory/locations/components/StorageLocationReloadRecovery';
import { prepareCommand as prepareLocation, inputDigest as locationDigest } from '@/features/inventory/locations/model';
import { actor as locationActor, location, requestId as locationRequestId } from '@/features/inventory/locations/__tests__/fixtures';
import { serviceApi } from '@/features/appointments/services/api';
import { useBookableServiceAccess } from '@/features/appointments/services/useBookableServiceAccess';
import { useBookableServiceCommand } from '@/features/appointments/services/useBookableServiceCommand';
import { ServiceChangeDialog } from '@/features/appointments/services/components/ServiceChangeDialog';
import { ServiceReloadRecovery } from '@/features/appointments/services/components/ServiceReloadRecovery';
import { actor as serviceActor, service, makeCommand, makeReceipt } from '@/features/appointments/services/__tests__/fixtures';

// Real generated transport, clock adapters, provider and access hooks execute.
// HTTP replies/JWT signatures are unit fixtures, not native authentication or
// backend persistence acceptance. No private denial witness is manufactured.
const runtime = window.__HMS_RUNTIME_CONFIG__;
const kinds = ['location', 'service'];
const definitions = {
  location: { api: storageLocationApi, actor: locationActor, value: location, path: '/api/v2/inventory/storage-locations', inputLabel: 'Location name', consent: 'I reviewed this exact storage-location change', find: 'Find original storage location result', busy: 'Confirming current location…' },
  service: { api: serviceApi, actor: serviceActor, value: service, path: '/api/v2/scheduling/services', inputLabel: 'Service name', consent: 'I reviewed this exact service change', find: 'Find original service result', busy: 'Confirming current service…' },
};
let user, bearer, decision, client, ownReads, posts, witnesses, sourceToken, controller, recorded, command, saved;

function principal() { return { id: user.id, facility_id: user.accessContext.facility_id, active_profile: user.accessContext.active_profile, session_version: user.accessContext.session_version, permission_version: user.accessContext.permission_version }; }
function activate() { activateWriteUncertainty(principal(), { authority: authorizationIdentity(user), transport: getV2ClientScopeKey() }); }
function issueBearer(session = '99999999-0000-4000-8000-000000000020') {
  const token = clockToken({ ordinary: true, session });
  bearer = jwtFor(token, { sub: user.id, facility_id: user.accessContext.facility_id, active_profile: user.accessContext.active_profile, session_version: user.accessContext.session_version ?? 1, permission_version: user.accessContext.permission_version, iat: issuerNow / 1000, auth_time: issuerNow / 1000, exp: issuerNow / 1000 + 600, session_id: session });
}
async function establish() {
  const binding = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), readOwnerValue: JSON.stringify(user), principal: principal() });
  activate(); decision = await networkApi.current(); binding.update({ confirmed: true, decision });
}
function observeActualErrors(api, method) {
  const actual = api[method];
  vi.spyOn(api, method).mockImplementation(async (...args) => {
    try { return await actual(...args); }
    catch (error) { witnesses.push({ method, current: isCurrentReadDenial(error), code: error.data?.error?.code }); throw error; }
  });
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear();
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  ownReads = []; posts = []; witnesses = []; sourceToken = {}; recorded = vi.fn();
  controller = { busy: false, locked: false, error: null, unknown: false, saved: null, run: vi.fn() };
  configureV2ApiClient({ getAccessToken: () => bearer, getFacilityCode: () => user?.facilityCode || 'QA', canRefreshSession: () => false });
  vi.stubGlobal('fetch', vi.fn((url, request = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/auth/network-access')) return Promise.resolve(json(clockNetwork()));
    if (path.endsWith('/dashboard/snapshot')) return Promise.resolve(failure('permission_denied', 403));
    if (request.method === 'POST') { posts.push(JSON.parse(request.body)); return Promise.reject(new TypeError('Synthetic possible committed reply loss')); }
    if (path.endsWith('/administration') || path.includes('/commands/')) return new Promise(resolve => ownReads.push({ signal: request.signal, original: path.includes('/commands/'), resolve }));
    return Promise.resolve(failure('synthetic_not_found', 404));
  }));
  for (const kind of kinds) for (const method of ['get', 'original', 'recover']) observeActualErrors(definitions[kind].api, method);
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
async function prepareKind(kind) {
  user = structuredClone(definitions[kind].actor); issueBearer(); await establish();
  command = kind === 'service' ? await makeCommand() : await prepareLocation({ action: 'rename', client_request_id: locationRequestId, location_id: location.id, expected_version: location.version, name: 'Synthetic corrected location' }, user.id, location);
  saved = kind === 'service' ? await makeReceipt(command) : { client_request_id: command.input.client_request_id, input_digest: await locationDigest(command.input), reviewed_input: command.input, recorded_by_user_id: user.id, location: { ...location, name: command.input.name, version: location.version + 1 }, changed: true, recorded_at: location.updated_at };
}
function AccessStatus({ access }) { return <output aria-label="Actual workflow access">{access.canWrite ? 'ready' : 'blocked'}</output>; }
function Preparation({ kind, access }) {
  const [open, setOpen] = useState(true), [denied, setDenied] = useState(false);
  const Dialog = kind === 'service' ? ServiceChangeDialog : StorageLocationChangeDialog;
  const selection = kind === 'service' ? { action: 'metadata', service } : { action: 'rename', location };
  return <><button onClick={() => setOpen(true)}>Reopen consumer</button>{denied ? <p>Own current consumer denied</p> : open && <Dialog {...{ access, controller, selection, sourceToken }} open onClose={() => setOpen(false)} onDenied={() => setDenied(true)} onDone={recorded} finishing={false} />}</>;
}
function Reload({ kind, access }) {
  const [denied, setDenied] = useState(false), Recovery = kind === 'service' ? ServiceReloadRecovery : StorageLocationReloadRecovery;
  return denied ? <p>Own current consumer denied</p> : <Recovery {...{ access }} onDenied={() => setDenied(true)} />;
}
function ServiceCommand({ access }) {
  const [denied, setDenied] = useState(false);
  const value = useBookableServiceCommand(access.scope, access.canWrite, () => setDenied(true), recorded);
  return denied ? <p>Own current consumer denied</p> : <><output aria-label="Original command state">{value.saved ? 'saved' : value.busy ? 'pending' : value.unknown ? 'unknown' : 'idle'}</output>{value.error && <p role="alert">{value.error}</p>}<button onClick={() => value.run(command)} disabled={!access.canWrite || value.busy}>Submit synthetic original</button><button onClick={() => value.run(null, true)} disabled={!access.canRecover || value.busy}>Check retained service original</button>{value.frozen && <output aria-label="Retained original request">{value.frozen.input.client_request_id}</output>}</>;
}
function LocationHost({ mode }) { const access = useStorageLocationAccess(); return <><AccessStatus access={access} /><Consumer key={access.scope} {...{ access, mode }} kind="location" /></>; }
function ServiceHost({ mode }) { const access = useBookableServiceAccess(); return <><AccessStatus access={access} /><Consumer key={access.scope} {...{ access, mode }} kind="service" /></>; }
function Consumer({ mode, ...props }) { return mode === 'reload' ? <Reload {...props} /> : mode === 'command' ? <ServiceCommand {...props} /> : <Preparation {...props} />; }
function ObservedConnection({ observation, children }) {
  const expired = useNetworkDecisionExpired(observation);
  const currentDecision = useMemo(() => restrictExpiredDecision(observation, expired), [observation, expired]);
  // Exercise the actual display restriction too: the clone deliberately has no
  // transport WeakMap proof. Consumers must retain their original dispatch
  // observation, rather than treating this display clone as fresh authority.
  return <ReadOnlyModeProvider network={{ confirmed: !expired, decision: currentDecision }}>{children}</ReadOnlyModeProvider>;
}
function mount(kind, mode = 'preparation') {
  const Host = kind === 'service' ? ServiceHost : LocationHost;
  const tree = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ObservedConnection observation={decision}><MemoryRouter>{mode !== 'preparation' && <WriteRecoveryNotice />}<Host mode={mode} /></MemoryRouter></ObservedConnection></AuthContext.Provider></QueryClientProvider>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function startPreparation(kind) {
  const before = ownReads.length;
  fireEvent.change(screen.getByLabelText(definitions[kind].inputLabel), { target: { value: 'Synthetic unsent private draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh and review change' }));
  await waitFor(() => expect(ownReads).toHaveLength(before + 1)); return ownReads.at(-1);
}
async function releaseRead(read, response) { await act(async () => read.resolve(response)); }
async function holdDenialBody(read, { malformed = false, code = 'permission_denied' } = {}) {
  const response = malformed ? new Response('malformed-json', { status: 403, headers: { 'content-type': 'application/json' } }) : failure(code, 403);
  const actualParse = response.json.bind(response); let release, entered = false;
  response.json = () => { entered = true; return new Promise((resolve, reject) => { release = () => actualParse().then(resolve, reject); }); };
  const originalDecision = decision;
  await releaseRead(read, response); await waitFor(() => expect(entered).toBe(true));
  // The real HTTP status has already reached session.js. Its synchronous clock
  // invalidation and reactive provider update happen before body publication.
  expect(networkClockCurrent(originalDecision)).toBe(false);
  await waitFor(() => expect(screen.getByLabelText('Actual workflow access')).toHaveTextContent('blocked'));
  return { originalDecision, release: () => act(async () => { await release(); }) };
}
async function primeReload(kind) {
  await expect(definitions[kind].api.write(command)).rejects.toMatchObject({ name: kind === 'service' ? 'ServiceUnconfirmedError' : 'StorageLocationUnconfirmedError' });
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate();
  await waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
}
function assertUnresolved(postCount = 1) {
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  expect(posts).toHaveLength(postCount);
  expect(screen.getByRole('button', { name: 'I reviewed the fresh workflow record' })).toBeDisabled();
}

it.each(kinds)('publishes a positive current %s preparation only after its actual GET succeeds', async kind => {
  await prepareKind(kind); mount(kind); const read = await startPreparation(kind);
  expect(screen.queryByLabelText(definitions[kind].consent)).not.toBeInTheDocument();
  await releaseRead(read, json(definitions[kind].value)); await screen.findByLabelText(definitions[kind].consent);
  expect(controller.run).not.toHaveBeenCalled(); expect(posts).toHaveLength(0);
});
it.each(kinds.flatMap(kind => [false, true].map(malformed => [kind, malformed])))('accepts an actual current %s detail403 after reactive invalidation, malformed=%s', async (kind, malformed) => {
  await prepareKind(kind); const view = mount(kind), read = await startPreparation(kind), held = await holdDenialBody(read, { malformed });
  try { expect(read.signal.aborted).toBe(false); } finally { await held.release(); }
  await waitFor(() => expect(witnesses.some(value => value.method === 'get' && value.current)).toBe(true)); await screen.findByText('Own current consumer denied');
  expect(screen.queryByDisplayValue('Synthetic unsent private draft')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(definitions[kind].consent)).not.toBeInTheDocument();
  await act(async () => { await establish(); view.update(); });
  expect(networkClockCurrent(held.originalDecision)).toBe(false); expect(networkClockCurrent(decision)).toBe(true);
  expect(screen.getByText('Own current consumer denied')).toBeInTheDocument(); expect(posts).toHaveLength(0);
});
it.each(kinds)('settles %s preparation after unrelated403 without publishing a late successful body', async kind => {
  await prepareKind(kind); mount(kind); const read = await startPreparation(kind);
  await act(async () => { await expect(v2Request({ path: '/api/v2/dashboard/snapshot' })).rejects.toMatchObject({ status: 403 }); });
  await releaseRead(read, json(definitions[kind].value));
  await waitFor(() => expect(screen.queryByRole('button', { name: definitions[kind].busy })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Close review' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Refresh and review change' })).toBeDisabled();
  expect(screen.queryByLabelText(definitions[kind].consent)).not.toBeInTheDocument(); expect(posts).toHaveLength(0);
});
it('keeps the real service directory-source epoch safeguard for an older current403', async () => {
  await prepareKind('service'); const view = mount('service'), read = await startPreparation('service'); sourceToken = { freshDirectory: true }; view.update();
  const held = await holdDenialBody(read);
  try { expect(read.signal.aborted).toBe(false); } finally { await held.release(); }
  expect(witnesses.some(value => value.method === 'get' && value.current)).toBe(true);
  expect(screen.queryByText('Own current consumer denied')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(definitions.service.consent)).not.toBeInTheDocument(); expect(posts).toHaveLength(0);
});
it('rejects a cancelled service detail403 after reopening under a genuine new request transport', async () => {
  await prepareKind('service'); const view = mount('service'), old = await startPreparation('service');
  fireEvent.click(screen.getByRole('button', { name: 'Close review' })); expect(old.signal.aborted).toBe(true);
  issueBearer('99999999-0000-4000-8000-000000000021'); await act(async () => { await establish(); view.update(); });
  fireEvent.click(screen.getByText('Reopen consumer')); const fresh = await startPreparation('service');
  await releaseRead(fresh, json(service)); await screen.findByLabelText(definitions.service.consent);
  await releaseRead(old, failure('old_cancelled_denial', 403));
  expect(screen.queryByText('Own current consumer denied')).not.toBeInTheDocument();
  expect(screen.getByLabelText(definitions.service.consent)).toBeInTheDocument(); expect(posts).toHaveLength(0);
});
it.each(kinds)('reads one current %s original after reload and requires a separate acknowledgment', async kind => {
  await prepareKind(kind); await primeReload(kind); mount(kind, 'reload');
  fireEvent.click(screen.getByRole('button', { name: definitions[kind].find })); await waitFor(() => expect(ownReads).toHaveLength(1));
  await releaseRead(ownReads[0], json(saved)); await screen.findByText(/Original action:/);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);
  const acknowledge = screen.getByRole('button', { name: 'I reviewed the fresh workflow record' }); expect(acknowledge).toBeEnabled();
  expect(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).not.toContain('Synthetic'); expect(posts).toHaveLength(1);
  fireEvent.click(acknowledge); await waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(0));
});
it.each(kinds.flatMap(kind => [false, true].map(malformed => [kind, malformed])))('conceals denied %s reload original, malformed=%s, without resolving or replaying it', async (kind, malformed) => {
  await prepareKind(kind); await primeReload(kind); const view = mount(kind, 'reload');
  fireEvent.click(screen.getByRole('button', { name: definitions[kind].find })); await waitFor(() => expect(ownReads).toHaveLength(1));
  const read = ownReads[0], held = await holdDenialBody(read, { malformed });
  try { expect(read.signal.aborted).toBe(false); } finally { await held.release(); }
  await waitFor(() => expect(witnesses.some(value => value.method === 'original' && value.current)).toBe(true)); await screen.findByText('Own current consumer denied');
  expect(screen.queryByText(/Original action:/)).not.toBeInTheDocument(); assertUnresolved();
  await act(async () => { await establish(); view.update(); });
  expect(screen.getByText('Own current consumer denied')).toBeInTheDocument(); expect(screen.queryByText(/Original action:/)).not.toBeInTheDocument(); assertUnresolved();
});
it.each(kinds)('settles an old %s original read after unrelated403 without publishing or acknowledging its successful body', async kind => {
  await prepareKind(kind); await primeReload(kind); mount(kind, 'reload'); fireEvent.click(screen.getByRole('button', { name: definitions[kind].find })); await waitFor(() => expect(ownReads).toHaveLength(1));
  await act(async () => { await expect(v2Request({ path: '/api/v2/dashboard/snapshot' })).rejects.toMatchObject({ status: 403 }); });
  await releaseRead(ownReads[0], json(saved));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Checking original result…' })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: definitions[kind].find })).toBeDisabled(); expect(screen.queryByText(/Original action:/)).not.toBeInTheDocument(); assertUnresolved();
});
it('does not apply an old location original403 after a committed actor A→B→A', async () => {
  await prepareKind('location'); await primeReload('location'); const originalUser = structuredClone(user), view = mount('location', 'reload');
  fireEvent.click(screen.getByRole('button', { name: definitions.location.find })); await waitFor(() => expect(ownReads).toHaveLength(1)); const old = ownReads[0];
  user = { ...user, id: '21212121-2121-4121-8121-000000000099' }; issueBearer(); await act(async () => { await establish(); view.update(); });
  user = originalUser; issueBearer(); await act(async () => { await establish(); view.update(); });
  expect(old.signal.aborted).toBe(true); await releaseRead(old, failure('old_actor_denial', 403));
  expect(screen.queryByText('Own current consumer denied')).not.toBeInTheDocument(); expect(witnesses.some(value => value.method === 'original' && value.current)).toBe(false);
  expect(screen.getByRole('button', { name: definitions.location.find })).toBeEnabled(); assertUnresolved();
});
async function startUncertainServiceRecovery() {
  await prepareKind('service'); const view = mount('service', 'command');
  fireEvent.click(screen.getByRole('button', { name: 'Submit synthetic original' }));
  await waitFor(() => expect(screen.getByLabelText('Original command state')).toHaveTextContent('unknown'));
  expect(posts).toHaveLength(1); expect(posts[0]).toEqual(Object.fromEntries(Object.entries(command.input).filter(([key]) => !['action', 'service_id'].includes(key))));
  fireEvent.click(screen.getByRole('button', { name: 'Check retained service original' })); await waitFor(() => expect(ownReads).toHaveLength(1));
  return { view, read: ownReads[0], originalInput: structuredClone(command.input) };
}
it('confirms an explicit current service original GET without a second POST', async () => {
  const { read, originalInput } = await startUncertainServiceRecovery(); await releaseRead(read, json(saved));
  await waitFor(() => expect(screen.getByLabelText('Original command state')).toHaveTextContent('saved'));
  expect(command.input).toEqual(originalInput); expect(posts).toHaveLength(1); expect(recorded).toHaveBeenCalledTimes(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each([false, true])('accepts a current service recover-only403 without self-cancelling its witness, malformed=%s', async malformed => {
  const { view, read, originalInput } = await startUncertainServiceRecovery(), held = await holdDenialBody(read, { malformed });
  try { expect(read.signal.aborted).toBe(false); } finally { await held.release(); }
  await screen.findByText('Own current consumer denied'); expect(witnesses.some(value => value.method === 'recover' && value.current)).toBe(true);
  expect(command.input).toEqual(originalInput); assertUnresolved(); expect(recorded).not.toHaveBeenCalled();
  await act(async () => { await establish(); view.update(); }); expect(screen.getByText('Own current consumer denied')).toBeInTheDocument(); assertUnresolved();
});
it('keeps an actual service recovery reauth_required unresolved without terminal access denial or automatic replay', async () => {
  const { read, originalInput } = await startUncertainServiceRecovery(), held = await holdDenialBody(read, { code: 'reauth_required' });
  try { expect(read.signal.aborted).toBe(false); } finally { await held.release(); }
  await waitFor(() => expect(screen.getByLabelText('Original command state')).toHaveTextContent('unknown'));
  expect(screen.queryByText('Own current consumer denied')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/current credentials|current sign-in/i);
  expect(screen.getByLabelText('Retained original request')).toHaveTextContent(originalInput.client_request_id);
  expect(command.input).toEqual(originalInput); assertUnresolved(); expect(recorded).not.toHaveBeenCalled();
});
