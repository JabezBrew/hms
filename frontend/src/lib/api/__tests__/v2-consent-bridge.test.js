import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consentApi } from '../consent';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 consent bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({
      getAccessToken: () => 'access-token-123',
      getFacilityCode: () => 'HMS',
    });
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('creates consent grants through Rust /api/v2 with generated envelopes', async () => {
    const signal = new AbortController().signal;
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'consent-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            scope: 'referral_coordination',
            purpose: 'Transfer discussion',
            status: 'active',
            expires_at: '2026-05-19T00:00:00Z',
            created_at: '2026-05-12T09:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const grant = await consentApi.createConsentGrant(
      {
        patient_identity_id: 'patient-1',
        target_facility_code: 'KATH',
        scope: 'full_record',
        reason: 'Transfer discussion',
        expires_at: '2026-05-19T00:00:00Z',
      },
      { signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/consents',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        signal,
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
        body: JSON.stringify({
          patient_id: 'patient-1',
          scope: 'referral_coordination',
          purpose: 'Transfer discussion',
          expires_at: '2026-05-19T00:00:00Z',
        }),
      }),
    );
    expect(grant).toEqual(
      expect.objectContaining({
        id: 'consent-1',
        patient: 'patient-1',
        patient_identity_id: 'patient-1',
        target_facility_code: 'KATH',
        scope: 'referral_coordination',
        reason: 'Transfer discussion',
        status: 'active',
      }),
    );
  });

  it('does not call legacy cross-facility referral or token endpoints in Rust V2 mode', async () => {
    await expect(
      consentApi.createReferral({
        patient_identity_id: 'patient-1',
        target_facility_code: 'KATH',
        reason_code: 'TRANSFER',
      }),
    ).rejects.toThrow('Cross-facility referral requests are not supported by Rust V2');

    await expect(
      consentApi.issueAccessToken('consent-1', {
        target_facility_code: 'KATH',
        ttl_seconds: 3600,
      }),
    ).rejects.toThrow('Consent access tokens are intentionally deferred in Rust V2');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
