import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clinicalUnitsApi, clinicsApi, unitTypesApi } from '../organization';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 organization bridge', () => {
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

  it('lists clinical departments through Rust admin org units and adapts legacy unit fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'unit-1',
              code: 'OPD',
              name: 'Outpatient Department',
              unit_type: 'department',
              is_active: true,
              parent_unit_id: null,
              parent_unit_name: null,
              created_at: '2026-05-12T03:26:23Z',
            },
            {
              id: 'unit-2',
              code: 'ADMIN',
              name: 'Administration',
              unit_type: 'administrative',
              is_active: true,
              parent_unit_id: null,
              parent_unit_name: null,
              created_at: '2026-05-12T03:26:23Z',
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

    const response = await clinicalUnitsApi.list({
      unit_type_code: 'department',
      unit_category: 'clinical',
      is_active: true,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/org-units?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual([
      {
        id: 'unit-1',
        code: 'OPD',
        name: 'Outpatient Department',
        unit_type: 'department',
        unit_type_code: 'department',
        unit_type_name: 'Department',
        unit_category: 'clinical',
        is_active: true,
        parent_unit_id: null,
        parent_unit_name: null,
        parentId: null,
        created_at: '2026-05-12T03:26:23Z',
      },
    ]);
  });

  it('lists clinics through Rust /api/v2 clinics and adapts scheduling fields for appointment setup', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'clinic-1',
              code: 'general',
              name: 'General Clinic',
              is_active: true,
              created_at: '2026-05-12T04:02:42Z',
            },
          ],
          page: { limit: 50, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await clinicsApi.list({ is_active: true, page_size: 50 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinics?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual([
      {
        id: 'clinic-1',
        code: 'general',
        name: 'General Clinic',
        is_active: true,
        created_at: '2026-05-12T04:02:42Z',
        booking_mode: 'clinic_pool',
        waitlist_enabled: false,
      },
    ]);
  });

  it('derives unit types from Rust org units without calling Django unit-type endpoints', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'unit-1',
              code: 'OPD',
              name: 'Outpatient Department',
              unit_type: 'department',
              is_active: true,
              parent_unit_id: null,
              parent_unit_name: null,
            },
            {
              id: 'unit-2',
              code: 'MWA',
              name: 'Medical Ward A',
              unit_type: 'ward',
              is_active: true,
              parent_unit_id: 'unit-1',
              parent_unit_name: 'Outpatient Department',
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

    const response = await unitTypesApi.list();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/org-units?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'department',
        code: 'department',
        name: 'Department',
        can_be_root: true,
      }),
      expect.objectContaining({
        id: 'ward',
        code: 'ward',
        name: 'Ward',
        can_be_root: false,
      }),
    ]);
  });
});
