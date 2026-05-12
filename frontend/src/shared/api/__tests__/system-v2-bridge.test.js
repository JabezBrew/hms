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

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/system/deployment-capabilities',
      expect.objectContaining({ method: 'GET' }),
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
  });
});
