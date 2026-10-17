import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AuthContext } from '@/lib/auth/AuthContext';
import { queryClient } from '@/lib/react-query';
import { __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/session';
import { requestAuthorizationScope } from '@/shared/lib/authorizationScope';
import { dismissFactorRequirement, publishFactorRequirement } from '@/shared/lib/factorRequiredSignal';
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary';
import { BreadcrumbProvider } from '@/components/layout/PageBreadcrumb';
import { IdentityVerificationLoader } from '../IdentityVerificationLoader';
import { json, networkDecision, token } from './fixtures';

// The optional dialog chunk is genuinely rejected at the dynamic-import seam.
// It must be contained beside the active workflow, not by the app boundary.
vi.mock('../IdentityVerificationNotice', () => { throw new Error('Synthetic offline optional chunk'); });
const runtime = window.__HMS_RUNTIME_CONFIG__;
const user = { id: 'synthetic-user', facilityCode: 'HMS', accessContext: { facility_id: 'synthetic-facility', active_profile: 'hospital' } };
const proofScope = (value = user) => requestAuthorizationScope(value, getV2ClientScopeKey());
const signal = (value = user) => act(() => publishFactorRequirement(proofScope(value)));
function Draft() { return <label>Synthetic clinical draft<input aria-label="Synthetic clinical draft" defaultValue="" /></label>; }
function View({ identity = user, load }) { return <AuthContext.Provider value={{ user: identity }}><IdentityVerificationLoader load={load} /><Draft /></AuthContext.Provider>; }

beforeEach(() => { __resetV2ApiClientForTests(); dismissFactorRequirement(); localStorage.clear(); sessionStorage.clear(); queryClient.clear(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' }; });
afterEach(() => { cleanup(); dismissFactorRequirement(); queryClient.clear(); __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear(); window.__HMS_RUNTIME_CONFIG__ = runtime; vi.unstubAllGlobals(); });

it('downloads no optional dialog without an exact current-scope signal', async () => {
  const load = vi.fn().mockResolvedValue({ IdentityVerificationNotice: () => <p>Synthetic loaded verification</p> });
  render(<View load={load} />);
  act(() => publishFactorRequirement('synthetic-other-scope'));
  await act(async () => {});
  expect(load).not.toHaveBeenCalled();
  signal(); await screen.findByText('Synthetic loaded verification');
  expect(load).toHaveBeenCalledOnce();
});

it('contains a chunk failure, preserves the draft and retries only on explicit request', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Synthetic offline')).mockResolvedValueOnce({ IdentityVerificationNotice: () => <p>Synthetic loaded verification</p> });
  render(<View load={load} />);
  fireEvent.change(screen.getByLabelText('Synthetic clinical draft'), { target: { value: 'SYNTHETIC PRIVATE DRAFT' } });
  signal(); await screen.findByText(/Identity verification could not be loaded/);
  expect(screen.getByDisplayValue('SYNTHETIC PRIVATE DRAFT')).toBeInTheDocument();
  expect(load).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('Retry loading verification'));
  await screen.findByText('Synthetic loaded verification');
  expect(load).toHaveBeenCalledTimes(2);
  expect(screen.getByDisplayValue('SYNTHETIC PRIVATE DRAFT')).toBeInTheDocument();
});

it('ignores a late optional chunk after the account scope changes', async () => {
  let finish; const load = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<View load={load} />);
  signal(); await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(<View identity={{ ...user, id: 'synthetic-new-user' }} load={load} />);
  await act(async () => finish({ IdentityVerificationNotice: () => <p>Synthetic obsolete verification</p> }));
  expect(screen.queryByText('Synthetic obsolete verification')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('keeps the actual provider and network-authorized draft mounted when the optional chunk rejects', async () => {
  let auth;
  function Host() { auth = useAuth(); return <><button onClick={() => auth.login('synthetic@example.test', 'Synthetic password', 'HMS')}>Synthetic sign-in</button>{auth.user && <NetworkAccessBoundary><Draft /></NetworkAccessBoundary>}</>; }
  vi.stubGlobal('fetch', vi.fn(async (input) => new URL(input).pathname.endsWith('/auth/login') ? json(token()) : json(networkDecision())));
  render(<QueryClientProvider client={queryClient}><MemoryRouter><HelmetProvider><BreadcrumbProvider><AuthProvider><Host /></AuthProvider></BreadcrumbProvider></HelmetProvider></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByText('Synthetic sign-in'));
  fireEvent.change(await screen.findByLabelText('Synthetic clinical draft'), { target: { value: 'SYNTHETIC PRIVATE PROVIDER DRAFT' } });
  signal(auth.user); await screen.findByText(/Identity verification could not be loaded/);
  expect(screen.getByDisplayValue('SYNTHETIC PRIVATE PROVIDER DRAFT')).toBeInTheDocument();
  expect(auth.isAuthenticated).toBe(true);
  expect(fetch.mock.calls.some(([url]) => url.includes('/assurance/'))).toBe(false);
  fireEvent.click(screen.getByText('Dismiss'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('SYNTHETIC PRIVATE PROVIDER DRAFT')).toBeInTheDocument();
});
