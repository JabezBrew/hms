// Proposed central admission coverage. Authored only; not executed.
import { StrictMode, useLayoutEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FeatureBasedRoute } from '@/components/auth/FeatureBasedRoute';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { __resetV2ApiClientForTests, configureV2ApiClient } from '@/lib/api/v2/client';
import { systemApi } from '@/shared/api/system';
import { useSystemCapabilities } from '../useSystemQueries';
vi.mock('@/shared/api/system', () => ({ systemApi: { getDeploymentCapabilities: vi.fn() } }));
const runtime = window.__HMS_RUNTIME_CONFIG__;
let user, client, pending;
const owner = () => ({ id: '27272727-0000-4000-8000-000000000101', adminAccess: { capabilities: ['system.deployment_capabilities.view'] }, accessContext: { facility_id: '27272727-0000-4000-8000-000000000102', active_profile: 'hospital', session_version: 1, permission_version: 1, features: ['laboratory'], patient_visibility: [] } });
function Wrapper({ children }) { return <AuthContext.Provider value={{ user }}><QueryClientProvider client={client}>{children}</QueryClientProvider></AuthContext.Provider>; }
beforeEach(() => {
  __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2' }; user = owner(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  systemApi.getDeploymentCapabilities.mockReset(); systemApi.getDeploymentCapabilities.mockResolvedValue({ features: { laboratory: true } }); pending = [];
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('refuses ungranted metadata including forced caller options, cached global data, placeholders and manual refetch', async () => {
  user.adminAccess.capabilities = ['laboratory.catalog.manage']; client.setQueryData(['system', 'deployment-capabilities'], { features: { laboratory: true } });
  const overridden = vi.fn(); const hook = renderHook(() => useSystemCapabilities({ enabled: true, queryKey: ['system', 'deployment-capabilities'], queryFn: overridden, initialData: { features: { laboratory: true } }, placeholderData: { features: { laboratory: true } } }), { wrapper: Wrapper });
  expect(hook.result.current.admissionDenied).toBe(true); expect(hook.result.current.data).toBeUndefined(); await act(async () => { await hook.result.current.refetch(); }); expect(hook.result.current.data).toBeUndefined(); expect(systemApi.getDeploymentCapabilities).not.toHaveBeenCalled(); expect(overridden).not.toHaveBeenCalled();
});
it('admits authorized metadata with AbortSignal while preserving an explicit caller-disabled query', async () => {
  const off = renderHook(() => useSystemCapabilities({ enabled: false }), { wrapper: Wrapper }); expect(off.result.current.admissionDenied).toBe(false); expect(systemApi.getDeploymentCapabilities).not.toHaveBeenCalled(); off.unmount();
  const on = renderHook(() => useSystemCapabilities(), { wrapper: Wrapper }); await waitFor(() => expect(on.result.current.data?.features.laboratory).toBe(true)); expect(systemApi.getDeploymentCapabilities).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
});
it('masks retained data immediately on permission revocation and refuses a late old response after replacement and ABA', async () => {
  systemApi.getDeploymentCapabilities.mockImplementation(({ signal }) => new Promise(resolve => pending.push({ signal, resolve })));
  const hook = renderHook(() => useSystemCapabilities(), { wrapper: Wrapper }); await waitFor(() => expect(pending).toHaveLength(1)); const first = pending[0], original = structuredClone(user);
  user = { ...user, adminAccess: { capabilities: [] }, accessContext: { ...user.accessContext, permission_version: 2 } }; hook.rerender(); expect(hook.result.current.admissionDenied).toBe(true); expect(hook.result.current.data).toBeUndefined(); expect(first.signal.aborted).toBe(true);
  user = original; hook.rerender(); await waitFor(() => expect(pending).toHaveLength(2)); await act(async () => first.resolve({ features: { old_only: true } })); expect(hook.result.current.data).toBeUndefined(); await act(async () => pending[1].resolve({ features: { current_only: true } })); await waitFor(() => expect(hook.result.current.data?.features.current_only).toBe(true)); expect(hook.result.current.data.features.old_only).toBeUndefined();
});
it.each(['actor', 'facility', 'profile', 'permission version', 'transport'])('isolates actual query identity across %s changes without placeholder exposure', async field => {
  const hook = renderHook(() => useSystemCapabilities(), { wrapper: Wrapper }); await waitFor(() => expect(hook.result.current.isSuccess).toBe(true)); const firstKey = client.getQueryCache().getAll()[0].queryKey;
  systemApi.getDeploymentCapabilities.mockImplementation(() => new Promise(() => {}));
  if (field === 'actor') user = { ...user, id: '27272727-0000-4000-8000-000000000103' };
  if (field === 'facility') user = { ...user, accessContext: { ...user.accessContext, facility_id: '27272727-0000-4000-8000-000000000103' } };
  if (field === 'profile') user = { ...user, accessContext: { ...user.accessContext, active_profile: 'clinic' } };
  if (field === 'permission version') user = { ...user, accessContext: { ...user.accessContext, permission_version: 2 } };
  if (field === 'transport') await act(async () => configureV2ApiClient({ getAccessToken: () => 'Synthetic other transport', getFacilityCode: () => 'QA27' }));
  hook.rerender(); expect(hook.result.current.data).toBeUndefined(); await waitFor(() => expect(systemApi.getDeploymentCapabilities).toHaveBeenCalledTimes(2)); const nextKey = client.getQueryCache().getAll().at(-1).queryKey; expect(nextKey).not.toEqual(firstKey); expect(JSON.stringify(nextKey)).not.toContain(user.id);
});
it('preserves the legacy no-auth-provider query and global key behavior', async () => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'legacy' }; const wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useSystemCapabilities(), { wrapper }); await waitFor(() => expect(hook.result.current.isSuccess).toBe(true)); expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['system', 'deployment-capabilities']); expect(hook.result.current.admissionDenied).toBe(false);
});
it('makes an ordinary feature guard unavailable when its separate metadata permission is absent, without a pending spinner or cached bypass', async () => {
  user.adminAccess.capabilities = ['laboratory.catalog.manage']; client.setQueryData(['system', 'deployment-capabilities'], { features: { laboratory: true } });
  render(<Wrapper><MemoryRouter initialEntries={['/protected']}><Routes><Route path="/protected" element={<FeatureBasedRoute features={['laboratory']}><p>Protected global feature content</p></FeatureBasedRoute>} /><Route path="/feature-unavailable" element={<p>Feature unavailable</p>} /></Routes></MemoryRouter></Wrapper>);
  await screen.findByText('Feature unavailable'); expect(screen.queryByText('Protected global feature content')).not.toBeInTheDocument(); expect(systemApi.getDeploymentCapabilities).not.toHaveBeenCalled();
});
it('survives StrictMode initial cleanup/resubscribe and refuses an abandoned first mount response after a real remount', async () => {
  let setups = 0, cleanups = 0;
  function Lifecycle({ children }) {
    useLayoutEffect(() => { setups++; return () => { cleanups++; }; }, []);
    return <Wrapper>{children}</Wrapper>;
  }
  const strictWrapper = ({ children }) => <StrictMode><Lifecycle>{children}</Lifecycle></StrictMode>;
  systemApi.getDeploymentCapabilities.mockImplementation(({ signal }) => new Promise(resolve => pending.push({ signal, resolve })));
  const first = renderHook(() => useSystemCapabilities(), { wrapper: strictWrapper });
  await waitFor(() => expect(pending.some(request => !request.signal.aborted)).toBe(true));
  expect(setups).toBeGreaterThanOrEqual(2); expect(cleanups).toBeGreaterThanOrEqual(1);
  const abandoned = [...pending]; first.unmount(); expect(abandoned.every(request => request.signal.aborted)).toBe(true);
  const second = renderHook(() => useSystemCapabilities(), { wrapper: strictWrapper });
  try {
    await waitFor(() => expect(pending.some(request => !abandoned.includes(request) && !request.signal.aborted)).toBe(true));
    const current = pending.findLast(request => !abandoned.includes(request) && !request.signal.aborted);
    await act(async () => { abandoned.forEach(request => request.resolve({ features: { abandoned_first_mount: true } })); });
    expect(second.result.current.data).toBeUndefined();
    await act(async () => current.resolve({ features: { current_remount: true } }));
    await waitFor(() => expect(second.result.current.data?.features.current_remount).toBe(true));
    expect(second.result.current.data.features.abandoned_first_mount).toBeUndefined();
  } finally {
    second.unmount();
    await act(async () => { pending.forEach(request => request.resolve({ features: { cleanup_only: true } })); });
  }
});
