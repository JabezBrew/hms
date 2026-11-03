import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setAuthTokenProvider, setFacilityCodeProvider } from '@/lib/api-client';
import { onboardingApi } from '../api';

const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const operations = [
  ['getActiveFlows', [], 'GET', '/api/workflows/onboarding/flows/active/'],
  ['getProgress', [['synthetic_flow']], 'GET', '/api/workflows/onboarding/progress/?flow_keys=synthetic_flow'],
  ['startProgress', [{ flow_key: 'synthetic_flow', flow_version: 1 }], 'POST', '/api/workflows/onboarding/progress/start/'],
  ['ingestEvents', [[{ name: 'synthetic.event' }]], 'POST', '/api/workflows/onboarding/events/ingest/'],
  ['skipStep', [{ flow_key: 'synthetic_flow', step_id: 'synthetic_step' }], 'POST', '/api/workflows/onboarding/steps/skip/'],
];

beforeEach(() => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django', apiBaseUrl: '/api' };
  setAuthTokenProvider(() => `synthetic.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.synthetic`, () => {}, () => {});
  setFacilityCodeProvider(() => 'SYNTHETIC');
  vi.stubGlobal('fetch', vi.fn(async () => response({ synthetic: true })));
});
afterEach(() => {
  setAuthTokenProvider(() => null, () => {}, () => {});
  setFacilityCodeProvider(() => null);
  window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(operations)('refuses unsupported Rust %s transport without a legacy request', async (operation, args) => {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', apiBaseUrl: '/api', v2ApiBaseUrl: '/api/v2' };
  await expect(onboardingApi[operation](...args)).rejects.toMatchObject({ name: 'OnboardingUnavailableError' });
  expect(fetch).not.toHaveBeenCalled();
});

it.each(operations)('preserves supported legacy %s transport and response', async (operation, args, method, path) => {
  await expect(onboardingApi[operation](...args)).resolves.toEqual({ synthetic: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(path);
  expect(fetch.mock.calls[0][1].method).toBe(method);
});

it.each(['getActiveFlows', 'getProgress'])('passes the original read cancellation signal through %s', async operation => {
  const controller = new AbortController();
  await (operation === 'getActiveFlows'
    ? onboardingApi.getActiveFlows({ signal: controller.signal })
    : onboardingApi.getProgress(['synthetic_flow'], { signal: controller.signal }));
  expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
});

it('preserves the actual legacy read AbortError', async () => {
  const error = new DOMException('Synthetic cancellation', 'AbortError');
  fetch.mockRejectedValueOnce(error);
  await expect(onboardingApi.getActiveFlows()).rejects.toBe(error);
});
