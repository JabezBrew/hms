import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { systemApi } from '../system';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 system bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
      defaultFacilityCode: 'HMS',
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

  it('adapts Rust feature keys to the existing JS route feature keys', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            deployment_profile: 'hospital',
            profile_label: 'Hospital',
            facility_id: 'facility-1',
            facility_code: 'HMS',
            features: {
              patients: true,
              appointments: true,
              encounters: true,
              billing: true,
              nhis: true,
              wards: true,
              admissions: true,
              nursing: true,
              laboratory: true,
              pharmacy: true,
              inventory: true,
              referrals: true,
              dashboards: true,
              admin: true,
            },
            capabilities: {
              outpatient_requires_active_clinic_schedule: false,
            },
            permissions: ['system.deployment_capabilities.view'],
            terminology: {},
            navigation: { groups: [] },
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const signal = new AbortController().signal;
    const response = await systemApi.getDeploymentCapabilities({ signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/system/deployment-capabilities',
      expect.objectContaining({ method: 'GET', signal }),
    );
    expect(response.features).toMatchObject({
      patients: true,
      patient_chronicle: true,
      patient_registration: true,
      outpatient_encounters: true,
      clinical_notes: true,
      emergency_encounters: true,
      wards: true,
      ward_task_board: true,
      inpatient_admissions: true,
      discharge_workflows: true,
      nursing_workflows: true,
      insurance_claims: true,
      audit: true,
      department_rosters: true,
    });
    expect(response.capabilities).toMatchObject({
      outpatient_requires_active_clinic_schedule: false,
    });
  });

  it('defaults Rust V2 outpatient registration away from roster-only clinic schedules', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            deployment_profile: 'hospital',
            profile_label: 'Hospital',
            facility_id: 'facility-1',
            facility_code: 'HMS',
            features: { patients: true },
            permissions: ['system.deployment_capabilities.view'],
            terminology: {},
            navigation: { groups: [] },
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await systemApi.getDeploymentCapabilities();

    expect(response.capabilities).toMatchObject({
      outpatient_requires_active_clinic_schedule: false,
      facility_switcher: false,
      multi_facility_mode: false,
    });
  });

  it('lists Rust V2 global feature overrides without calling the old settings endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              feature: 'patients',
              enabled: false,
              profile_default: true,
              override_enabled: false,
              updated_at: '2026-05-12T08:00:00Z',
              updated_by_user_id: 'user-1',
            },
            {
              feature: 'appointments',
              enabled: true,
              profile_default: true,
              override_enabled: null,
              updated_at: null,
              updated_by_user_id: null,
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await systemApi.getFeatureEntitlements(
      { page_size: 200 },
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/features',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual({
      results: [
        expect.objectContaining({
          id: 'patients',
          feature_key: 'patients',
          scope: 'global',
          is_enabled: false,
          source: 'global_override',
        }),
      ],
      count: 1,
      next: null,
      previous: null,
    });
  });

  it('creates a global feature override through the Rust V2 feature patch endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            feature: 'patients',
            enabled: true,
            profile_default: false,
            override_enabled: true,
            updated_at: '2026-05-12T08:00:00Z',
            updated_by_user_id: 'user-1',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const signal = new AbortController().signal;
    const response = await systemApi.createFeatureEntitlement({
      scope: 'global',
      feature_key: 'patients',
      is_enabled: true,
      reason: 'Enable patient module',
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/features/patients',
      expect.objectContaining({
        method: 'PATCH',
        signal,
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(response).toMatchObject({
      id: 'patients',
      feature_key: 'patients',
      is_enabled: true,
    });
  });

  it('updates a global feature override through the Rust V2 feature patch endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            feature: 'patients',
            enabled: false,
            profile_default: true,
            override_enabled: false,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const signal = new AbortController().signal;
    const response = await systemApi.updateFeatureEntitlement('patients', {
      is_enabled: false,
      reason: 'Temporarily disable',
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/features/patients',
      expect.objectContaining({
        method: 'PATCH',
        signal,
        body: JSON.stringify({ enabled: false }),
      }),
    );
    expect(response).toMatchObject({
      id: 'patients',
      feature_key: 'patients',
      is_enabled: false,
    });
  });

  it('fails closed for facility feature overrides because Rust V2 exposes only global feature overrides', async () => {
    await expect(
      systemApi.createFeatureEntitlement({
        scope: 'facility',
        facility: 'facility-1',
        feature_key: 'patients',
        is_enabled: true,
      }),
    ).rejects.toThrow(/facility feature overrides/i);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('deletes a global feature override through the Rust V2 feature delete endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            feature: 'patients',
            enabled: true,
            profile_default: true,
            override_enabled: null,
            updated_at: null,
            updated_by_user_id: null,
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const signal = new AbortController().signal;
    const response = await systemApi.deleteFeatureEntitlement('patients', { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/features/patients',
      expect.objectContaining({ method: 'DELETE', signal }),
    );
    expect(response).toMatchObject({
      id: 'patients',
      feature_key: 'patients',
      is_enabled: true,
      source: 'deployment_profile',
    });
  });

  it('preserves AbortError from Rust V2 system calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError)
      .mockRejectedValueOnce(abortError);

    await expect(systemApi.getDeploymentCapabilities()).rejects.toBe(abortError);
    await expect(
      systemApi.getFeatureEntitlements({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
    await expect(
      systemApi.createFeatureEntitlement(
        { scope: 'global', feature_key: 'patients', is_enabled: true },
        { signal: new AbortController().signal },
      ),
    ).rejects.toBe(abortError);
    await expect(
      systemApi.updateFeatureEntitlement(
        'patients',
        { is_enabled: false },
        { signal: new AbortController().signal },
      ),
    ).rejects.toBe(abortError);
    await expect(
      systemApi.deleteFeatureEntitlement('patients', { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
