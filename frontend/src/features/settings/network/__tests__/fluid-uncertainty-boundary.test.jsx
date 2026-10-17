import { useState } from 'react';
import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { resetWriteUncertaintyForTests } from '@/lib/api/v2/writeUncertainty';
import { FluidPanel } from '@/features/nursing/fluid/FluidPanel';
import { NetworkAccessBoundary } from '../NetworkAccessBoundary';
import { networkKeys } from '../hooks';
import { networkDecision, networkUser } from './fixtures';

const patientId = 'f1000000-0000-4000-8000-000000000001';
const admissionId = 'f1000000-0000-4000-8000-000000000002';
const entryId = 'f1000000-0000-4000-8000-000000000003';
const privateNote = 'SYNTHETIC-PRIVATE-FLUID-NOTE';
const originalFetch = globalThis.fetch;
const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const prototypeDescriptors = ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView'].map((name) => [name, Object.getOwnPropertyDescriptor(Element.prototype, name)]);
const user = { ...networkUser, accessContext: { ...networkUser.accessContext, session_version: 1, features: ['nursing'], patient_visibility: ['demographics', 'full_clinical'] }, adminAccess: { capabilities: ['nursing.task.manage'] } };
const rules = { version: 0, configured: false, values: { min_daily_intake_target: 1500, max_daily_output_threshold: 3000, negative_balance_alert_threshold: -500, positive_balance_alert_threshold: 2000, enable_intake_alerts: false, enable_output_alerts: false, enable_balance_alerts: false } };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
let client; let token; let expiresAt; let posts; let rows; let responseMode;

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
  for (const [name, descriptor] of prototypeDescriptors) if (!descriptor) Object.defineProperty(Element.prototype, name, { configurable: true, value: name === 'hasPointerCapture' ? () => false : () => {} });
});
afterAll(() => {
  for (const [name, descriptor] of prototypeDescriptors) { if (descriptor) Object.defineProperty(Element.prototype, name, descriptor); else delete Element.prototype[name]; }
  vi.unstubAllGlobals();
});
beforeEach(() => {
  sessionStorage.clear();
  __resetV2ApiClientForTests();
  token = 'SYNTHETIC-PRIVATE-TOKEN'; expiresAt = Date.now() + 60000; posts = []; rows = []; responseMode = 'lost';
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => token, setAccessToken: (value) => { token = value; }, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 1, retryDelay: 0 } } });
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const parsed = new URL(url); const path = parsed.pathname;
    // A delayed/cached decision does not get to extend its signed-in deadline.
    if (path.endsWith('/auth/network-access')) return json({ data: { ...networkDecision, classification: 'offsite', mode: 'fresh_reauth', reason: 'offsite_fresh_reauth', read_only: false, reauth_required: false, reauth_expires_at: new Date(expiresAt).toISOString() } });
    if (options.method === 'POST' && path.endsWith('/fluid-observations')) {
      const body = JSON.parse(options.body); posts.push(body);
      rows = [{ id: entryId, root_entry_id: entryId, patient_id: patientId, admission_case_id: admissionId, current: true, revision: 1, created_at: new Date().toISOString(), recorded_by_display_name: 'Synthetic clinician', values: body.values }];
      if (responseMode === 'malformed') return json({ data: {} });
      if (responseMode === 'confirmed') return json({ data: { client_request_id: body.client_request_id, root_entry_id: entryId, entry_id: entryId, revision: 1, action: 'created', replayed: false } });
      if (responseMode === 'pending') return new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(new DOMException('Synthetic response lost on unmount', 'AbortError')), { once: true }); });
      throw new TypeError('Synthetic response lost after the server saved the observation');
    }
    if (path.endsWith('/fluid-observations/context')) return json({ data: { patient_id: patientId, admission_case_id: admissionId, status: 'admitted', can_record_observation: true } });
    if (path.endsWith('/summary')) return json({ data: { entry_count: rows.length, total_intake_ml: rows.length ? 250 : 0, total_output_ml: 0, net_ml: rows.length ? 250 : 0, intake_breakdown: [], output_breakdown: [] } });
    if (path.endsWith('/assessment')) return json({ data: { patient_id: patientId, admission_case_id: admissionId, date: parsed.searchParams.get('date'), status: 'unconfigured', settings: rules, conditions: [], entry_count: rows.length, total_intake_ml: rows.length ? 250 : 0, total_output_ml: 0, net_ml: rows.length ? 250 : 0 } });
    if (path.endsWith('/fluid-observations')) return json({ data: rows, page: { has_next: false, next_cursor: null, limit: 25 } });
    throw new Error('Unexpected synthetic test route');
  });
});
afterEach(() => {
  client.clear();
  __resetV2ApiClientForTests();
  sessionStorage.clear();
  window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function Harness({ initialUser = user }) {
  const [actor, setActor] = useState(initialUser);
  const login = async () => { token += '-confirmed'; expiresAt = Date.now() + 60000; setActor({ ...initialUser }); return initialUser; };
  return <AuthContext.Provider value={{ user: actor, login, logout: vi.fn() }}><QueryClientProvider client={client}><MemoryRouter><HelmetProvider><BreadcrumbProvider><NetworkAccessBoundary><FluidPanel open patient={{ id: patientId, name: 'Synthetic patient' }} admission={{ id: admissionId }} onClose={vi.fn()} /></NetworkAccessBoundary></BreadcrumbProvider></HelmetProvider></MemoryRouter></QueryClientProvider></AuthContext.Provider>;
}
async function fillObservation(note) {
  const events = userEvent.setup();
  fireEvent.change(await screen.findByLabelText('Intake volume (ml)'), { target: { value: '250' } });
  await events.click(screen.getByLabelText('Intake category'));
  await events.click(screen.getByRole('option', { name: 'Oral' }));
  fireEvent.change(screen.getByLabelText('Observation notes (optional)'), { target: { value: note } });
  await events.click(screen.getByRole('button', { name: 'Record fluid observation' }));
}
async function expireAndConfirm() {
  expiresAt = Date.now() - 1;
  await act(async () => { await client.invalidateQueries({ queryKey: networkKeys.root }); });
  await screen.findByText('A fresh sign-in is required');
  expect(screen.queryByRole('dialog', { name: 'Fluid balance' })).not.toBeInTheDocument();
  expect(screen.queryByText(privateNote)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm current password' }));
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'SYNTHETIC-PRIVATE-PASSWORD' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }));
  await screen.findByRole('dialog', { name: 'Fluid balance' });
  await waitFor(() => expect(client.isFetching()).toBe(0));
}
function assertPrivateStorage() {
  const persisted = JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)));
  expect(persisted).not.toBe('{}');
  for (const secret of [patientId, admissionId, entryId, privateNote, user.email, 'SYNTHETIC-PRIVATE-TOKEN', 'SYNTHETIC-PRIVATE-PASSWORD']) expect(persisted).not.toContain(secret);
}

it('blocks a new real fluid command after a saved lost response and expiry unmount followed by same-actor confirmation', async () => {
  render(<Harness />);
  await fillObservation(privateNote);
  await screen.findByRole('button', { name: 'Retry exact observation' });
  expect(posts).toHaveLength(1);
  assertPrivateStorage();
  await expireAndConfirm();
  await fillObservation('Synthetic new attempt after lost controller state');
  expect(posts).toHaveLength(1);
  assertPrivateStorage();
});

it('re-marks a malformed successful fluid receipt so a later remount cannot submit a new UUID', async () => {
  responseMode = 'malformed';
  const view = render(<Harness />);
  await fillObservation(privateNote);
  await screen.findByRole('button', { name: 'Retry exact observation' });
  expect(posts).toHaveLength(1);
  assertPrivateStorage();
  view.unmount();
  await act(async () => { await client.cancelQueries({ queryKey: networkKeys.root }); });
  resetWriteUncertaintyForTests({ preserveStorage: true });
  render(<Harness />);
  await fillObservation('Synthetic new attempt after malformed receipt');
  expect(posts).toHaveLength(1);
});

it('retains an opaque barrier when a saved in-flight POST is aborted by the network boundary', async () => {
  responseMode = 'pending';
  render(<Harness />);
  await fillObservation(privateNote);
  await screen.findByRole('button', { name: 'Saving…' });
  await waitFor(() => expect(posts).toHaveLength(1));
  await expireAndConfirm();
  assertPrivateStorage();
  await fillObservation('Synthetic new attempt after dispatched abort');
  expect(posts).toHaveLength(1);
});

it('isolates another actor while preserving the earlier actor barrier across a simulated reload', async () => {
  let view = render(<Harness />);
  await fillObservation(privateNote);
  await screen.findByRole('button', { name: 'Retry exact observation' });
  expect(posts).toHaveLength(1);
  view.unmount();
  token = 'SYNTHETIC-PRIVATE-TOKEN-B';
  responseMode = 'confirmed';
  view = render(<Harness initialUser={{ ...user, id: 'synthetic-other-actor', email: 'synthetic-other@example.test' }} />);
  await fillObservation('SYNTHETIC-OTHER-PRIVATE-NOTE');
  await screen.findByText('Fluid observation saved.');
  expect(posts).toHaveLength(2);
  view.unmount();
  resetWriteUncertaintyForTests({ preserveStorage: true });
  token = 'SYNTHETIC-PRIVATE-TOKEN-A-RETURNED';
  render(<Harness />);
  await fillObservation('Synthetic earlier actor new attempt after reload');
  expect(posts).toHaveLength(2);
  assertPrivateStorage();
  expect(JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))).not.toContain('SYNTHETIC-OTHER-PRIVATE-NOTE');
});
