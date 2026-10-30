import { webcrypto } from 'node:crypto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ModeledReadOnlyModeProvider as ReadOnlyModeProvider } from '@/tests/networkClockModel';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindModeledNetworkGuard as bindNetworkAccessGuard } from '@/tests/networkClockModel';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { WriteRecoveryNotice } from '@/features/settings/network/WriteRecoveryNotice';
import BookableServiceDirectoryPage from '../BookableServiceDirectoryPage';
import { serviceApi } from '../api';
import { actor, actorId, facilityId, service, envelope, makeCommand, makeReceipt } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch;
const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
let client, saved, resultStatus, malformed;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function activate() { activateWriteUncertainty(principal, { authority: authorizationIdentity(actor), transport: getV2ClientScopeKey() }); }
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-SERVICE-RELOAD', getFacilityCode: () => 'QA', canRefreshSession: () => false });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(actor), principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activate();
  const command = await makeCommand(); saved = await makeReceipt(command); resultStatus = 200; malformed = false; globalThis.fetch = vi.fn().mockRejectedValueOnce(new TypeError('Synthetic reply lost after possible commit')); await expect(serviceApi.write(command)).rejects.toMatchObject({ name: 'ServiceUnconfirmedError' });
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate(); await waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));
  fetch.mockImplementation(async url => new URL(url).pathname.includes('/commands/') ? resultStatus === 200 ? response({ data: malformed ? { ...saved, input_digest: '0'.repeat(64) } : saved }) : response({ error: { code: 'unavailable' } }, resultStatus) : response(envelope([service])));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; globalThis.fetch = originalFetch; });
function mount() { return render(<QueryClientProvider client={client}><AuthContext.Provider value={{ user: actor }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }}><MemoryRouter><WriteRecoveryNotice /><BookableServiceDirectoryPage /></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>); }
it('finds the actual singleton actor original after reload, then requires a separate current acknowledgment', async () => {
  mount(); const ev = userEvent.setup(); await screen.findByText(service.name); const acknowledgment = screen.getByRole('button', { name: 'I reviewed the fresh workflow record' }); expect(acknowledgment).toBeDisabled(); expect(screen.getByRole('button', { name: 'Add service' })).toBeDisabled();
  await ev.click(screen.getByRole('button', { name: 'Find original service result' })); await screen.findByText(/Original action: Edit details. Service: Synthetic corrected service/); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); expect(acknowledgment).toBeEnabled();
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1); expect(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).not.toContain('Synthetic'); await ev.click(acknowledgment); await waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(0)); expect(screen.getByRole('button', { name: 'Add service' })).toBeEnabled();
});
it.each(['missing', 'malformed', 'denial'])('keeps the reload barrier for %s original evidence without synthesizing a body', async fault => {
  resultStatus = fault === 'missing' ? 404 : fault === 'denial' ? 403 : 200; malformed = fault === 'malformed'; mount(); const ev = userEvent.setup(); await screen.findByText(service.name); await ev.click(screen.getByRole('button', { name: 'Find original service result' }));
  if (fault === 'denial') { await screen.findByText('Bookable service administration unavailable'); expect(screen.queryByText(service.name)).not.toBeInTheDocument(); } else await screen.findByText(/The original service result could not be confirmed/);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false); expect(screen.getByRole('button', { name: 'I reviewed the fresh workflow record' })).toBeDisabled(); expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1); expect(screen.queryByText(/Original action: Edit details/)).not.toBeInTheDocument();
});
