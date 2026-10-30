import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/session';
import { useSecuritySettings } from '../security/useSecuritySettings';
import { hasFreshPasskey } from '../model';
import { clockToken, clockObservation, databaseNow, issuerNow } from './clock-fixtures';
import { keyId, json } from './fixtures';
// Actual factorApi.assurance transport + Query; HTTP/JWT signatures modeled.
const runtime = window.__HMS_RUNTIME_CONFIG__; let client, state, next;
function Probe() { state = useSecuritySettings('opaque-clock-review'); return null; }
beforeEach(() => {
  __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' }; const token = clockToken().access_token;
  configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false }); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  next = () => ({ password_verified_at: new Date(databaseNow - 120000).toISOString(), password_fresh_until: new Date(databaseNow + 780000).toISOString(), assurance: { method: 'passkey', verified_at: new Date(databaseNow).toISOString(), expires_at: new Date(databaseNow + 900000).toISOString(), credential_id: keyId }, auth_clock: clockObservation() });
  vi.stubGlobal('fetch', vi.fn(async url => new URL(url).pathname.endsWith('/mfa/passkeys') ? new Response(JSON.stringify({ data: [], page: { has_next: false, next_cursor: null, limit: 10 } }), { status: 200 }) : json(next())));
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('keeps actual factor clock evidence after a current proof refetch changes its timestamps', async () => {
  render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); await waitFor(() => expect(state.assurance.isSuccess).toBe(true)); expect(hasFreshPasskey(state.assurance.data.assurance)).toBe(true);
  const original = state.assurance.data.assurance; const first = next; next = () => { const value = first(); value.assurance.verified_at = new Date(databaseNow + 200).toISOString(); value.assurance.expires_at = new Date(databaseNow + 900200).toISOString(); value.auth_clock = { database_observed_at: new Date(databaseNow + 200).toISOString(), issuer_observed_at: new Date(issuerNow + 200).toISOString(), access_token_remaining_ms: 599800 }; return value; };
  let result; await act(async () => { result = await state.assurance.refetch(); }); expect(result.data.assurance).not.toBe(original); expect(hasFreshPasskey(result.data.assurance)).toBe(true);
});
