import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/react-query';
import { __resetV2ApiClientForTests } from '@/lib/api/v2/session';
import { useRustSessionTimeoutWarning } from '@/components/session-timeout/useRustSessionTimeoutWarning';
import { setAuthValue } from '@/lib/auth-storage';
import { json, failure } from './fixtures';
import { clockToken, issuerNow } from './clock-fixtures';
// Real provider, warning hook, generated SDK and transport; modeled HTTP/token
// signatures and monotonic passage are explicit unit preconditions, not native.
const runtime = window.__HMS_RUNTIME_CONFIG__;
let auth, warning, elapsed, reply, paths;
function Probe() { auth = useAuth(); warning = useRustSessionTimeoutWarning(true); return <button onClick={() => auth.login('synthetic@example.test', 'Synthetic password', 'HMS').catch(() => {})}>Start warning clock session</button>; }
async function mount() { render(<QueryClientProvider client={queryClient}><MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter></QueryClientProvider>); fireEvent.click(await screen.findByText('Start warning clock session')); await waitFor(() => expect(auth.user).not.toBeNull()); }
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); localStorage.clear(); sessionStorage.clear(); queryClient.clear(); __resetV2ApiClientForTests();
  elapsed = 0; const base = performance.now(); vi.spyOn(performance, 'now').mockImplementation(() => base + elapsed);
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' }; paths = []; reply = () => failure('synthetic_unavailable', 503);
  vi.stubGlobal('fetch', vi.fn(async url => { const path = new URL(url).pathname; paths.push(path); if (path.endsWith('/auth/login')) return json(clockToken()); if (path.endsWith('/auth/logout')) return json({}); if (path.endsWith('/auth/refresh')) return reply(); return failure('synthetic_unavailable', 404); }));
});
afterEach(() => { cleanup(); queryClient.clear(); __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear(); document.cookie = 'hms_v2_csrf=;max-age=0;path=/'; vi.unstubAllGlobals(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each([86400000, -86400000])('ignores stale persisted server deadlines and browser skew=%s while the actual RAM budget is live', async skew => {
  vi.spyOn(Date, 'now').mockReturnValue(issuerNow + skew); await mount(); setAuthValue('sessionIdleExpiresAt', '2000-01-01T00:00:00Z'); setAuthValue('sessionAbsoluteExpiresAt', '2000-01-01T00:00:00Z');
  fireEvent.focus(window); expect(auth.getSessionBudget().remaining).toBeGreaterThan(0); expect(auth.getAccessToken()).not.toBeNull(); expect(warning.showWarning).toBe(false); expect(paths.some(path => path.endsWith('/auth/logout'))).toBe(false);
});
it('keeps a transient real refresh failure paused rather than claiming server revocation', async () => {
  await mount(); document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/'; await act(async () => { await warning.handleExtendSession(); });
  expect(paths.filter(path => path.endsWith('/auth/refresh'))).toHaveLength(1); expect(auth.user).not.toBeNull(); expect(auth.sessionReady).toBe(false); expect(auth.getAccessToken()).toBeNull(); fireEvent.focus(window); expect(auth.user).not.toBeNull(); expect(warning.showWarning).toBe(false); expect(paths.some(path => path.endsWith('/auth/logout'))).toBe(false);
});
it('renews only the stricter local activity budget and still expires after genuine local inactivity', async () => {
  await mount(); elapsed = 590000; const before = auth.getSessionBudget(); fireEvent.mouseDown(document); const after = auth.getSessionBudget();
  expect(after.remaining).toBe(before.remaining); expect(after.localRemaining).toBeGreaterThan(before.localRemaining); expect(after.remaining).toBeLessThan(11000);
  elapsed += 1800001; fireEvent.focus(window); await act(async () => { await Promise.resolve(); }); expect(auth.user).toBeNull(); expect(auth.getAccessToken()).toBeNull();
});
