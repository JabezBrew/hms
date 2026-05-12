import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { staffApi } from '../staff';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 staff bridge', () => {
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

  it('loads staff rows through Rust /api/v2 and adapts them for the existing staff page', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'staff-1',
              user_id: 'user-1',
              display_name: 'Ama Mensah',
              email: 'ama@example.test',
              employee_id: 'EMP-001',
              department: 'Nursing',
              position: 'Ward Nurse',
              hire_date: '2026-01-01',
              is_active: true,
              password_change_required: false,
              session_version: 1,
              permission_version: 1,
              practitioner_profile: null,
              created_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 25, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await staffApi.getStaff({ page_size: 25 }, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/staff?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'staff-1',
        user_id: 'user-1',
        name: 'Ama Mensah',
        email: 'ama@example.test',
        employee_id: 'EMP-001',
        department: 'Nursing',
        position: 'Ward Nurse',
        is_active: true,
      }),
    ]);
  });

  it('preserves AbortError from Rust staff directory calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      staffApi.getStaff({}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });

  it('loads practitioners through Rust /api/v2 and adapts legacy practitioner fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'practitioner-1',
              staff_id: 'staff-1',
              user_id: 'user-1',
              display_name: 'Ama Mensah',
              employee_id: 'EMP-001',
              license_number: 'MDC-001',
              specialization: 'General Medicine',
              qualification: 'MBChB',
              is_active: true,
              created_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 25, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await staffApi.getPractitioners({ page_size: 25 }, { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/practitioners?limit=25',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'practitioner-1',
        staff: 'staff-1',
        name: 'Ama Mensah',
        license_number: 'MDC-001',
        specialization: 'General Medicine',
        user_details: expect.objectContaining({
          first_name: 'Ama',
          last_name: 'Mensah',
        }),
      }),
    ]);
  });

  it('searches practitioners in Rust mode without calling the legacy practitioner search endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'practitioner-1',
              staff_id: 'staff-1',
              user_id: 'user-1',
              display_name: 'Ama Mensah',
              employee_id: 'EMP-001',
              license_number: 'MDC-001',
              specialization: 'General Medicine',
              qualification: 'MBChB',
              is_active: true,
              created_at: '2026-05-12T08:00:00Z',
            },
            {
              id: 'practitioner-2',
              staff_id: 'staff-2',
              user_id: 'user-2',
              display_name: 'Kojo Boateng',
              employee_id: 'EMP-002',
              license_number: 'MDC-002',
              specialization: 'Surgery',
              qualification: 'MBChB',
              is_active: true,
              created_at: '2026-05-12T08:00:00Z',
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

    const response = await staffApi.searchPractitioners('ama');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/practitioners?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'practitioner-1',
        name: 'Ama Mensah',
      }),
    ]);
  });
});
