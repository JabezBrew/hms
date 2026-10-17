import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { referralsApi } from '@/lib/api/referrals';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { referralId } from './fixtures';
const initialRuntime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token' }); globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: referralId, status: 'scheduled', specialist_notes: 'Synthetic private old response' } }), { status: 200, headers: { 'content-type': 'application/json' } })); });
afterEach(() => { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = initialRuntime; globalThis.fetch = originalFetch; });
it.each(['complete', 'update', 'start'])('retires the old Rust %s shortcut with explicit guidance and no request', async operation => {
  const call = operation === 'complete' ? () => referralsApi.completeReferral(referralId, 'Synthetic reviewed notes', '') : operation === 'update' ? () => referralsApi.updateReferralResponse(referralId, 'Synthetic reviewed notes', '') : () => referralsApi.startConsultation(referralId);
  await expect(call()).rejects.toThrow(/Chronicle|consultation/i); expect(fetch).not.toHaveBeenCalled();
});
it('removes specialist body fields from the old Rust routing projection', async () => { const value = await referralsApi.getReferral(referralId); expect(value.specialist_notes).toBeNull(); expect(value.recommendations).toBeNull(); });

it('preserves an explicit aborted retired call without starting any request', async () => { const controller = new AbortController(); controller.abort(); await expect(referralsApi.completeReferral(referralId, 'Synthetic reviewed notes', '', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled(); });
