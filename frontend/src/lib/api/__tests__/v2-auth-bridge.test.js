import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authApi } from '../auth';
import { __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 auth bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    vi.stubEnv('VITE_DEFAULT_FACILITY_CODE', '');
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
    vi.unstubAllEnvs();
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

    const signal = new AbortController().signal;
    const response = await authApi.login('owner@hms.local', 'secret-password', 'HMS', { signal });

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
        signal,
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

  it('rejects Rust V2 login locally when no facility code is available', async () => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };

    await expect(authApi.login('owner@hms.local', 'secret-password')).rejects.toThrow(
      'Facility code is required for Rust V2 login',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('loads the current profile through /api/v2/auth/me', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'user-1',
            email: 'owner@hms.local',
            display_name: 'HMS Owner',
            facility_id: 'facility-1',
            facility_code: 'HMS',
            active_profile: 'hospital',
            permissions: ['system.deployment_capabilities.view'],
            features: ['patient_chronicle'],
            patient_visibility: ['demographics'],
            session_version: 1,
            permission_version: 1,
            password_change_required: false,
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
    const profile = await authApi.getProfile({ signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/auth/me',
      expect.objectContaining({ method: 'GET', credentials: 'include', signal }),
    );
    expect(profile).toMatchObject({
      id: 'user-1',
      email: 'owner@hms.local',
      first_name: 'HMS',
      last_name: 'Owner',
      facility_code: 'HMS',
    });
  });

  it('updates the current profile through /api/v2/auth/me', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'user-1',
            email: 'owner@hms.local',
            display_name: 'Updated Owner',
            facility_id: 'facility-1',
            facility_code: 'HMS',
            active_profile: 'hospital',
            permissions: ['system.deployment_capabilities.view'],
            features: ['patient_chronicle'],
            patient_visibility: ['demographics'],
            session_version: 1,
            permission_version: 1,
            password_change_required: false,
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
    const profile = await authApi.updateProfile({
      first_name: 'Updated',
      last_name: 'Owner',
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/auth/me',
      expect.objectContaining({
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({
          display_name: 'Updated Owner',
        }),
        signal,
      }),
    );
    expect(profile).toMatchObject({
      id: 'user-1',
      first_name: 'Updated',
      last_name: 'Owner',
      facility_code: 'HMS',
    });
  });

  it('requests and completes password reset through /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { accepted: true }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { completed: true }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const signal = new AbortController().signal;
    await expect(authApi.requestPasswordReset('owner@hms.local', { signal })).resolves.toMatchObject({
      accepted: true,
    });
    await expect(
      authApi.resetPassword('reset-token', 'NewPassword123!', 'NewPassword123!', { signal }),
    ).resolves.toMatchObject({ completed: true });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/auth/password-reset/request',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@hms.local',
          facility_code: 'HMS',
        }),
        signal,
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/auth/password-reset/complete',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          token: 'reset-token',
          new_password: 'NewPassword123!',
        }),
        signal,
      }),
    );
  });

  it('changes the signed-in password through /api/v2', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { changed: true }, meta: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const signal = new AbortController().signal;
    await expect(
      authApi.changePassword({
        oldPassword: 'ChangeMe123!',
        newPassword: 'Replacement123!',
      }, { signal }),
    ).resolves.toEqual({ changed: true });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/auth/password',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          current_password: 'ChangeMe123!',
          new_password: 'Replacement123!',
        }),
        signal,
      }),
    );
  });

  it('manages auth sessions through /api/v2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              results: [
                {
                  id: 'session-current',
                  device_label: 'Safari on macOS',
                  created_at: '2026-05-13T12:00:00Z',
                  last_seen_at: '2026-05-13T12:05:00Z',
                  expires_at: '2026-05-13T18:00:00Z',
                  is_current: true,
                },
              ],
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { revoked: true }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { revoked_count: 2 }, meta: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    const signal = new AbortController().signal;
    await expect(authApi.listSessions({ signal })).resolves.toEqual({
      results: [
        expect.objectContaining({
          id: 'session-current',
          is_current: true,
        }),
      ],
    });
    await expect(authApi.revokeSession('session-other', { signal })).resolves.toEqual({ revoked: true });
    await expect(authApi.revokeAllSessions(true, { signal })).resolves.toEqual({ revoked_count: 2 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/auth/sessions',
      expect.objectContaining({ method: 'GET', signal }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/auth/sessions/session-other/revoke',
      expect.objectContaining({ method: 'POST', signal }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/auth/sessions/revoke-all',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ exclude_current: true }),
        signal,
      }),
    );
  });

  it('preserves AbortError from Rust V2 auth calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      authApi.login('owner@hms.local', 'secret-password', 'HMS', {
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(abortError);
  });

  it('allows reset-token submission when Rust V2 has no token pre-validation endpoint', async () => {
    await expect(authApi.validateResetToken('reset-token')).resolves.toEqual({
      valid: true,
      email: '',
      rust_v2_unverified: true,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for Rust V2 auth operations that are not exposed yet', async () => {
    await expect(authApi.mfaStatus()).rejects.toThrow(
      'Rust V2 does not expose MFA management yet',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
