import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AuthContext } from '@/lib/auth/AuthContext';
import { queryClient } from '@/lib/react-query';
import { __resetV2ApiClientForTests } from '@/lib/api/v2/session';
import { LoginForm } from '@/components/auth/login-form';
import { FactorLoginLoader } from '../FactorLoginLoader';
import { json, pending } from './fixtures';

vi.mock('../FactorLogin', () => { throw new Error('Synthetic offline optional sign-in chunk'); });
const runtime = window.__HMS_RUNTIME_CONFIG__;
function View({ grant, load, cancel = vi.fn() }) { return <AuthContext.Provider value={{ pendingFactor: grant, cancelPendingLogin: cancel }}><FactorLoginLoader load={load} /></AuthContext.Provider>; }

beforeEach(() => { __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear(); queryClient.clear(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' }; });
afterEach(() => { cleanup(); queryClient.clear(); __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear(); window.__HMS_RUNTIME_CONFIG__ = runtime; vi.unstubAllGlobals(); });

it('loads the factor UI only after a restricted grant exists', async () => {
  const load = vi.fn().mockResolvedValue({ FactorLogin: () => <p>Synthetic factor verification</p> });
  const view = render(<View grant={null} load={load} />);
  await act(async () => {}); expect(load).not.toHaveBeenCalled();
  view.rerender(<View grant={pending()} load={load} />);
  await screen.findByText('Synthetic factor verification'); expect(load).toHaveBeenCalledOnce();
});

it('locally contains a download failure and offers explicit retry and cancellation', async () => {
  const grant = pending(); const cancel = vi.fn();
  const load = vi.fn().mockRejectedValueOnce(new Error('Synthetic offline')).mockResolvedValueOnce({ FactorLogin: () => <p>Synthetic factor verification</p> });
  render(<View {...{ grant, cancel, load }} />);
  await screen.findByText(/Sign-in verification could not be loaded/);
  expect(load).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('Cancel and restart sign-in')); expect(cancel).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('Retry loading sign-in verification'));
  await screen.findByText('Synthetic factor verification'); expect(load).toHaveBeenCalledTimes(2);
});

it('discards a late optional UI after its grant is cancelled', async () => {
  let finish; const load = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<View grant={pending()} load={load} />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(<View grant={null} load={load} />);
  await act(async () => finish({ FactorLogin: () => <p>Synthetic obsolete sign-in</p> }));
  expect(screen.queryByText('Synthetic obsolete sign-in')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('keeps the actual provider unauthenticated after the public factor chunk fails and permits a clean restart', async () => {
  let auth;
  function Host() { auth = useAuth(); return auth.user ? <p>Synthetic protected clinical page</p> : <LoginForm />; }
  vi.stubGlobal('fetch', vi.fn(async () => json(pending())));
  render(<QueryClientProvider client={queryClient}><MemoryRouter><AuthProvider><Host /></AuthProvider></MemoryRouter></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'synthetic@example.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Synthetic password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  await screen.findByText(/Sign-in verification could not be loaded/);
  expect(auth.isAuthenticated).toBe(false); expect(auth.pendingFactor.status).toBe('factor_required');
  expect(screen.queryByText('Synthetic protected clinical page')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-restricted-login-grant');
  expect(JSON.stringify(sessionStorage)).not.toContain('synthetic-restricted-login-grant');
  fireEvent.click(screen.getByText('Cancel and restart sign-in'));
  await screen.findByLabelText('Email Address'); expect(auth.pendingFactor).toBeNull();
  expect(auth.isAuthenticated).toBe(false);
});
