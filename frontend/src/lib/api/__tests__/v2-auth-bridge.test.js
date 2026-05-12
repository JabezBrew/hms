import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authApi } from '../auth';
import { __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 auth bridge', () => {
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
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('logs in through /api/v2 and adapts the Rust envelope to the existing auth context shape', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            access_token: 'access-token-123',
            token_type: 'Bearer',
            expires_in_seconds: 600,
            user: {
              id: 'user-1',
              email: 'owner@hms.local',
              display_name: 'HMS Owner',
              facility_id: 'facility-1',
              facility_code: 'HMS',
              active_profile: 'hospital',
              permissions: ['system.deployment_capabilities.view', 'patient.demographics.view'],
              features: ['patient_chronicle'],
              patient_visibility: ['demographics'],
              session_version: 1,
              permission_version: 1,
              password_change_required: false,
            },
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await authApi.login('owner@hms.local', 'secret-password', 'HMS');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          email: 'owner@hms.local',
          password: 'secret-password',
          facility_code: 'HMS',
        }),
      }),
    );
    expect(response).toMatchObject({
      access: 'access-token-123',
      user: {
        id: 'user-1',
        email: 'owner@hms.local',
        user_type: 'admin',
        first_name: 'HMS',
        last_name: 'Owner',
        facility_code: 'HMS',
        admin_access: {
          capabilities: ['system.deployment_capabilities.view', 'patient.demographics.view'],
        },
      },
      access_context: {
        permissions: ['system.deployment_capabilities.view', 'patient.demographics.view'],
        features: ['patient_chronicle'],
        patient_visibility: ['demographics'],
        active_profile: 'hospital',
      },
      password_change_required: false,
    });
  });

  it('uses the configured default facility when the existing login form does not pass one', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            access_token: 'access-token-123',
            token_type: 'Bearer',
            expires_in_seconds: 600,
            user: {
              id: 'user-1',
              email: 'owner@hms.local',
              display_name: 'HMS Owner',
              facility_id: 'facility-1',
              facility_code: 'HMS',
              active_profile: 'hospital',
              permissions: ['patient.demographics.view'],
              features: ['patient_chronicle'],
              patient_visibility: ['demographics'],
              session_version: 1,
              permission_version: 1,
              password_change_required: false,
            },
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await authApi.login('owner@hms.local', 'secret-password');

    const [, request] = globalThis.fetch.mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({
      facility_code: 'HMS',
    });
  });
});
