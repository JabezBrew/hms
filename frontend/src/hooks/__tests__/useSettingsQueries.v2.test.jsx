import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useChangePassword,
  useMfaStatus,
  useProfile,
  useRevokeAllSessions,
  useRevokeSession,
  useUserSessions,
} from '../useSettingsQueries';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 settings queries', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;
  let queryClient;

  function wrapper({ children }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
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
    queryClient.clear();
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('uses the Rust auth profile endpoint for settings profile data', async () => {
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

    const { result } = renderHook(() => useProfile(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/auth/me',
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(result.current.data).toMatchObject({
      email: 'owner@hms.local',
      first_name: 'HMS',
      last_name: 'Owner',
    });
  });

  it('loads active sessions through the Rust V2 auth contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            results: [
              {
                id: 'session-current',
                device_label: 'Safari on macOS',
                created_at: '2026-05-13T12:00:00Z',
                last_seen_at: '2026-05-13T12:05:00Z',
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
    );

    const { result } = renderHook(() => useUserSessions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/auth/sessions',
      expect.objectContaining({
        method: 'GET',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
        }),
      }),
    );
    expect(result.current.data).toEqual({
      results: [
        expect.objectContaining({
          id: 'session-current',
          device_label: 'Safari on macOS',
          is_current: true,
        }),
      ],
    });
  });

  it('revokes sessions through the Rust V2 auth contract', async () => {
    globalThis.fetch
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

    const revokeOne = renderHook(() => useRevokeSession(), { wrapper });
    const revokeAll = renderHook(() => useRevokeAllSessions(), { wrapper });

    await act(async () => {
      await revokeOne.result.current.mutateAsync('session-other');
      await revokeAll.result.current.mutateAsync(true);
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/auth/sessions/session-other/revoke',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/auth/sessions/revoke-all',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ exclude_current: true }),
      }),
    );
  });

  it('changes the signed-in password through the Rust V2 auth contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { changed: true },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useChangePassword(), { wrapper });

    let response;
    await act(async () => {
      response = await result.current.mutateAsync({
        oldPassword: 'ChangeMe123!',
        newPassword: 'Replacement123!',
      });
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/auth/password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          current_password: 'ChangeMe123!',
          new_password: 'Replacement123!',
        }),
      }),
    );
    expect(response).toEqual({ changed: true });
  });

  it('does not call legacy MFA endpoints when Rust V2 has no MFA management contract', async () => {
    const { result } = renderHook(() => useMfaStatus(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      totp_enrolled: false,
      webauthn_enrolled: false,
      recovery_codes_remaining: 0,
      rust_v2_unsupported: true,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
