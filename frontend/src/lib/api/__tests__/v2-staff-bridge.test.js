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

  it('searches practitioners in Rust mode through server-side V2 filters instead of a broad list', async () => {
    const controller = new AbortController();
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

    const response = await staffApi.searchPractitioners('ama', false, {
      signal: controller.signal,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/practitioners?limit=25&search=ama&is_active=true',
      expect.objectContaining({
        method: 'GET',
        signal: controller.signal,
      }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'practitioner-1',
        name: 'Ama Mensah',
      }),
    ]);
  });

  it('searches staff in Rust mode through server-side V2 filters instead of a broad list', async () => {
    const controller = new AbortController();
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
              is_active: true,
              practitioner_profile: {
                id: 'practitioner-1',
                license_number: 'MDC-001',
                specialization: 'General Medicine',
                qualification: 'MBChB',
                fhir_practitioner_id: null,
              },
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

    const response = await staffApi.searchStaff('ama', {
      practitionersOnly: true,
      signal: controller.signal,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/staff?limit=25&search=ama&is_active=true&practitioners_only=true',
      expect.objectContaining({
        method: 'GET',
        signal: controller.signal,
      }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'staff-1',
        name: 'Ama Mensah',
        employee_id: 'EMP-001',
      }),
    ]);
  });

  it('loads staff detail through the Rust V2 staff detail endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
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
            created_at: '2026-05-12T08:00:00Z',
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
    const response = await staffApi.getStaffMember('staff-1', { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/staff/staff-1',
      expect.objectContaining({ method: 'GET', signal }),
    );
    expect(response).toMatchObject({
      id: 'staff-1',
      name: 'Ama Mensah',
      user_details: {
        first_name: 'Ama',
        last_name: 'Mensah',
        email: 'ama@example.test',
        is_active: true,
      },
    });
  });

  it('creates staff through the Rust V2 staff contract when the V2-required fields are present', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'staff-3',
            user_id: 'user-3',
            display_name: 'Akosua Addo',
            email: 'akosua@example.test',
            employee_id: 'EMP-003',
            department: 'Laboratory',
            position: 'Lab Technician',
            hire_date: '2026-05-01',
            is_active: true,
            password_change_required: true,
            session_version: 1,
            permission_version: 1,
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await staffApi.createStaff({
      email: 'akosua@example.test',
      first_name: 'Akosua',
      last_name: 'Addo',
      temporary_password: 'ChangeMe123!',
      employee_id: 'EMP-003',
      department: 'Laboratory',
      position: 'Lab Technician',
      hire_date: '2026-05-01',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/staff',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'akosua@example.test',
          display_name: 'Akosua Addo',
          temporary_password: 'ChangeMe123!',
          employee_id: 'EMP-003',
          department: 'Laboratory',
          position: 'Lab Technician',
          hire_date: '2026-05-01',
        }),
      }),
    );
    expect(response).toMatchObject({
      id: 'staff-3',
      name: 'Akosua Addo',
    });
  });

  it('updates staff through the Rust V2 staff contract without legacy fallback', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'staff-1',
            user_id: 'user-1',
            display_name: 'Ama Updated',
            email: 'ama@example.test',
            employee_id: 'EMP-001',
            department: 'Emergency',
            position: 'Charge Nurse',
            hire_date: '2026-01-01',
            is_active: true,
            password_change_required: false,
            session_version: 1,
            permission_version: 1,
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await staffApi.updateStaff('staff-1', {
      first_name: 'Ama',
      last_name: 'Updated',
      department: 'Emergency',
      position: 'Charge Nurse',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/staff/staff-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          display_name: 'Ama Updated',
          department: 'Emergency',
          position: 'Charge Nurse',
        }),
      }),
    );
    expect(response).toMatchObject({
      id: 'staff-1',
      name: 'Ama Updated',
      department: 'Emergency',
      position: 'Charge Nurse',
    });
  });

  it('deactivates staff through the Rust V2 lifecycle endpoint instead of deleting through legacy', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'staff-1',
            user_id: 'user-1',
            display_name: 'Ama Mensah',
            email: 'ama@example.test',
            employee_id: 'EMP-001',
            department: 'Nursing',
            position: 'Ward Nurse',
            hire_date: '2026-01-01',
            is_active: false,
            password_change_required: false,
            session_version: 2,
            permission_version: 2,
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await staffApi.deleteStaff('staff-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/staff/staff-1/deactivate',
      expect.objectContaining({
        method: 'POST',
        body: undefined,
      }),
    );
    expect(response).toMatchObject({
      id: 'staff-1',
      is_active: false,
    });
  });

  it('reactivates staff through Rust V2 and returns the mode shape expected by the current UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'staff-1',
            user_id: 'user-1',
            display_name: 'Ama Mensah',
            email: 'ama@example.test',
            employee_id: 'EMP-001',
            department: 'Nursing',
            position: 'Ward Nurse',
            hire_date: '2026-01-01',
            is_active: true,
            password_change_required: true,
            session_version: 3,
            permission_version: 3,
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await staffApi.reactivateStaff('staff-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/staff/staff-1/reactivate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(response).toMatchObject({
      mode: 'password_reset',
      staff: {
        id: 'staff-1',
        is_active: true,
      },
    });
  });

  it('resends setup links through the Rust V2 force-password-reset lifecycle endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'staff-1',
            user_id: 'user-1',
            display_name: 'Ama Mensah',
            email: 'ama@example.test',
            employee_id: 'EMP-001',
            department: 'Nursing',
            position: 'Ward Nurse',
            hire_date: '2026-01-01',
            is_active: true,
            password_change_required: true,
            session_version: 4,
            permission_version: 4,
            created_at: '2026-05-12T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await staffApi.resendSetupLink('staff-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/staff/staff-1/force-password-reset',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(response).toMatchObject({
      mode: 'password_reset',
      staff: {
        id: 'staff-1',
        password_change_required: true,
      },
    });
  });

  it('loads a practitioner detail through the Rust V2 practitioner detail contract without list-and-find fetching', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
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
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await staffApi.getPractitioner('practitioner-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/practitioners/practitioner-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toMatchObject({
      id: 'practitioner-1',
      staff: 'staff-1',
      name: 'Ama Mensah',
      license_number: 'MDC-001',
    });
  });
});
