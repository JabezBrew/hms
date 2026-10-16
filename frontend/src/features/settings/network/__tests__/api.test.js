import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { networkApi } from '../api';
import { candidatePreview, networkDecision, networkPolicy } from './fixtures';

const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const payload = { client_request_id: '00000000-0000-4000-8000-000000000001', expected_version: 3, onsite_cidrs: ['10.10.4.0/24'], offsite_mode: 'readonly', reason: 'Synthetic reviewed network change' };
const saved = { client_request_id: payload.client_request_id, replayed: false, policy: { ...networkPolicy, version: 4, onsite_cidrs: payload.onsite_cidrs } };
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
describe('actual generated network access operations', () => {
  it('preserves the four real method/path/body/AbortSignal boundaries and separate ordinary/admin DTOs', async () => {
    const signal = new AbortController().signal; globalThis.fetch.mockResolvedValueOnce(json({ data: { ...networkDecision, client_ip: '203.0.113.5' } })); expect(await networkApi.current({ signal })).toEqual(networkDecision);
    globalThis.fetch.mockResolvedValueOnce(json({ data: { policy: networkPolicy, current_access: networkDecision, can_update: true } })); await networkApi.policy({ signal }); globalThis.fetch.mockResolvedValueOnce(json({ data: candidatePreview })); await networkApi.preview({ onsite_cidrs: ['10.10.4.9/24'], offsite_mode: 'readonly' }, { signal }); globalThis.fetch.mockResolvedValueOnce(json({ data: saved })); await expect(networkApi.save(payload, { signal })).resolves.toEqual(saved);
    expect(globalThis.fetch.mock.calls.map(([url, options]) => [options.method, new URL(url).pathname])).toEqual([['GET', '/api/v2/auth/network-access'], ['GET', '/api/v2/admin/network-policy'], ['POST', '/api/v2/admin/network-policy/preview'], ['PUT', '/api/v2/admin/network-policy']]); for (const [, options] of globalThis.fetch.mock.calls) expect(options.signal).toBe(signal); expect(JSON.parse(globalThis.fetch.mock.calls[2][1].body)).toEqual({ onsite_cidrs: ['10.10.4.9/24'], offsite_mode: 'readonly' }); expect(JSON.parse(globalThis.fetch.mock.calls[3][1].body)).toEqual(payload);
  });
  it.each([{}, { ...saved, client_request_id: 'different' }, { ...saved, policy: { ...saved.policy, version: 5 } }, { ...saved, policy: { ...saved.policy, onsite_cidrs: ['10.20.0.0/16'] } }, { ...saved, policy: { ...saved.policy, offsite_mode: 'deny' } }])('treats malformed or different publication receipts as unknown without repeating a PUT', async (value) => { globalThis.fetch.mockResolvedValueOnce(json({ data: value })); await expect(networkApi.save(payload)).rejects.toMatchObject({ name: 'NetworkPolicyUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1); });
  it('distinguishes typed conflicts from generic unconfirmed writes and preserves cancelled reads', async () => {
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'network_policy_write_unconfirmed', message: 'Unconfirmed' } }, 409)); await expect(networkApi.save(payload)).rejects.toMatchObject({ name: 'NetworkPolicyUnconfirmedError' }); globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'network_policy_version_conflict', message: 'Reload policy' } }, 409)); await expect(networkApi.save(payload)).rejects.toMatchObject({ status: 409 }); globalThis.fetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError')); await expect(networkApi.current()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
