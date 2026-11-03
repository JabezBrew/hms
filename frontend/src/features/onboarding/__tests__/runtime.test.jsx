import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { setAuthTokenProvider, setFacilityCodeProvider } from '@/lib/api-client';
import OnboardingRuntime from '../components/OnboardingRuntime';
import { useOnboardingRuntime } from '../hooks/useOnboardingRuntime';
import { configureOnboardingEventTransport, emitOnboardingEvent, flushOnboardingEvents, setOnboardingEventEnabled } from '../events';

const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const flow = {
  flow_key: 'synthetic_flow', version: 1,
  definition: { title: 'Synthetic onboarding', steps: [
    { id: 'synthetic_first', title: 'Synthetic first step', action: { route: '/synthetic-next' } },
    { id: 'synthetic_second', title: 'Synthetic second step' },
  ] },
};
let user, client, requests, progress, flowsEmpty, deferFlows, deferProgress, pending;

beforeEach(() => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django', apiBaseUrl: '/api' };
  user = { id: 'synthetic-actor-a', role: 'doctor', accessContext: { facility_id: 'synthetic-facility-a' } };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  progress = { flow_key: flow.flow_key, flow_version: 1, status: 'in_progress', current_step_index: 0, completed_step_ids: [], skipped_step_ids: [] };
  requests = []; pending = []; flowsEmpty = deferFlows = deferProgress = false;
  setAuthTokenProvider(() => `synthetic.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.synthetic`, () => {}, () => {});
  setFacilityCodeProvider(() => 'SYNTHETIC');
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    requests.push({ url, method: options.method, signal: options.signal });
    if (url.endsWith('/flows/active/')) {
      if (deferFlows) return new Promise((resolve, reject) => {
        const release = () => resolve(response({ flows: [flow] })); pending.push({ release, signal: options.signal });
        options.signal?.addEventListener('abort', () => reject(new DOMException('Synthetic cancellation', 'AbortError')), { once: true });
      });
      return response({ flows: flowsEmpty ? [] : [flow] });
    }
    if (url.includes('/progress/?')) {
      if (deferProgress) return new Promise((resolve, reject) => {
        const release = () => resolve(response({ progress: [progress] })); pending.push({ release, signal: options.signal });
        options.signal?.addEventListener('abort', () => reject(new DOMException('Synthetic cancellation', 'AbortError')), { once: true });
      });
      return response({ progress: [progress] });
    }
    if (url.endsWith('/progress/start/')) { progress = { ...progress, status: 'in_progress' }; return response(progress); }
    if (url.endsWith('/steps/skip/')) { progress = { ...progress, current_step_index: 1, skipped_step_ids: ['synthetic_first'] }; return response(progress); }
    if (url.endsWith('/events/ingest/')) return response({ updated: [] });
    throw new Error('Unexpected synthetic onboarding request');
  }));
});
afterEach(async () => {
  cleanup(); pending.forEach(item => item.release()); client.clear();
  // Drain synthetic test telemetry through an inert transport so module state
  // cannot transfer queued events into the next test's real adapter stub.
  configureOnboardingEventTransport(async () => {}); setOnboardingEventEnabled(true); await flushOnboardingEvents();
  setOnboardingEventEnabled(false); configureOnboardingEventTransport(null);
  setAuthTokenProvider(() => null, () => {}, () => {}); setFacilityCodeProvider(() => null);
  window.__HMS_RUNTIME_CONFIG__ = originalRuntime; vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function Wrapper({ children }) {
  return <QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><MemoryRouter>{children}</MemoryRouter></AuthContext.Provider></QueryClientProvider>;
}
function rust() { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', apiBaseUrl: '/api', v2ApiBaseUrl: '/api/v2' }; }
const posts = () => requests.filter(request => request.method === 'POST');

it('keeps the actual unsupported Rust startup component quiet without a legacy read', async () => {
  rust(); flowsEmpty = true;
  const view = render(<OnboardingRuntime />, { wrapper: Wrapper });
  await act(async () => Promise.resolve());
  expect(fetch).not.toHaveBeenCalled();
  expect(view.container).toBeEmptyDOMElement();
});

it('returns no onboarding state or actions in Rust even after a real legacy flow was cached', async () => {
  const { result, rerender } = renderHook(() => ({ ...useOnboardingRuntime(), pathname: useLocation().pathname }), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.shouldRender).toBe(true));
  const staleSkip = result.current.skipCurrentStep, staleOpen = result.current.openCurrentStep;
  rust(); rerender(); const previousRequests = requests.length;
  expect(client.getQueryCache().getAll().some(query => query.state.data?.flows?.[0]?.flow_key === flow.flow_key)).toBe(true);
  expect(result.current).toMatchObject({ enabled: false, shouldRender: false, isLoading: false, isMutating: false, currentStep: null, totalSteps: 0, flowTitle: '' });
  await act(async () => { staleOpen(); await staleSkip(); emitOnboardingEvent('synthetic.after_mode_change'); await flushOnboardingEvents(); });
  expect(requests).toHaveLength(previousRequests); expect(posts()).toHaveLength(0); expect(result.current.pathname).toBe('/');
});

it.each(['unsupported transport', 'logout', 'unmount'])('cancels a pending legacy read on %s without a follow-up progress request', async transition => {
  deferFlows = true;
  const { rerender, unmount } = renderHook(() => useOnboardingRuntime(), { wrapper: Wrapper });
  await waitFor(() => expect(pending).toHaveLength(1));
  const signal = pending[0].signal;
  if (transition === 'unsupported transport') { rust(); rerender(); }
  else if (transition === 'logout') { user = null; rerender(); }
  else unmount();
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => pending[0].release());
  expect(requests).toHaveLength(1); expect(posts()).toHaveLength(0);
});

it('cancels pending legacy progress on the Rust transition and keeps a late result hidden', async () => {
  deferProgress = true;
  const { result, rerender } = renderHook(() => useOnboardingRuntime(), { wrapper: Wrapper });
  await waitFor(() => expect(pending).toHaveLength(1)); const signal = pending[0].signal;
  rust(); rerender(); await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => pending[0].release());
  expect(result.current.shouldRender).toBe(false); expect(result.current.currentStep).toBeNull();
  expect(requests).toHaveLength(2); expect(posts()).toHaveLength(0);
});

it('keeps the legacy flow, automatic start and explicit skip workflow functional', async () => {
  progress.status = 'not_started';
  const { result } = renderHook(() => ({ ...useOnboardingRuntime(), pathname: useLocation().pathname }), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.shouldRender).toBe(true));
  expect(result.current.currentStep.id).toBe('synthetic_first'); expect(result.current.totalSteps).toBe(2);
  expect(posts().filter(request => request.url.endsWith('/progress/start/'))).toHaveLength(1);
  act(() => result.current.openCurrentStep()); expect(result.current.pathname).toBe('/synthetic-next');
  await act(async () => result.current.skipCurrentStep());
  await waitFor(() => expect(result.current.currentStep.id).toBe('synthetic_second'));
  expect(posts().filter(request => request.url.endsWith('/steps/skip/'))).toHaveLength(1);
});

it.each(['unsupported role', 'anonymous'])('preserves disabled legacy %s without reads or writes', async state => {
  if (state === 'anonymous') user = null; else user = { ...user, role: 'nurse' };
  const { result } = renderHook(() => useOnboardingRuntime(), { wrapper: Wrapper });
  await act(async () => { await result.current.skipCurrentStep(); await flushOnboardingEvents(); });
  expect(result.current.enabled).toBe(false); expect(result.current.shouldRender).toBe(false); expect(fetch).not.toHaveBeenCalled();
});
