import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthProviderController } from '@/lib/auth/useAuthProviderController';
import { __resetV2ApiClientForTests } from '@/lib/api/v2/session';
import { queryClient } from '@/lib/react-query';
import { clearWorkflowContinuity } from '@/shared/lib/workflowContinuity';
import { AUTH_STORAGE_KEYS } from '@/lib/auth-storage';
import { getStorageKey } from '@/lib/safe-storage';
import { fixtureClock, json, jwtFor, token } from './fixtures';

const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
let raw;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); queryClient.clear();
  __resetV2ApiClientForTests(); clearWorkflowContinuity();
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' };
  raw = token(null, { password_change_required: true });
  const now = Date.now(); const second = Math.floor(now / 1000);
  raw.access_token = jwtFor(raw, { iat: second, exp: second + 600, auth_time: second - 5 });
  raw.user.auth_security.auth_clock = fixtureClock(now, raw.access_token);
  vi.stubGlobal('fetch', vi.fn(async () => json(raw)));
});
afterEach(() => {
  cleanup(); queryClient.clear(); __resetV2ApiClientForTests(); clearWorkflowContinuity();
  localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
});

it('persists one explicit password-requirement transition under React StrictMode replay', async () => {
  const hook = renderHook(() => useAuthProviderController(), { wrapper: StrictMode });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => hook.result.current.login('synthetic@example.test', 'Synthetic private password', 'HMS'));
  expect(hook.result.current.user.passwordChangeRequired).toBe(true);
  const storage = vi.spyOn(localStorage, 'setItem');
  act(() => hook.result.current.clearPasswordChangeRequirement());
  expect(hook.result.current.user.passwordChangeRequired).toBe(false);
  expect(storage.mock.calls.filter(([key]) => key === getStorageKey(AUTH_STORAGE_KEYS.user.current))).toHaveLength(1);
  act(() => hook.result.current.clearPasswordChangeRequirement());
  hook.rerender();
  expect(storage.mock.calls.filter(([key]) => key === getStorageKey(AUTH_STORAGE_KEYS.user.current))).toHaveLength(1);
});
