import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clinicalUnitsApi,
  clinicSchedulesApi,
  departmentDutyTypesApi,
  dutyRosterApi,
  leadershipRolesApi,
  rosterEntriesApi,
  unitTypesApi,
  validationRulesApi,
  clinicsApi,
} from '../organization';
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

  it('loads clinic detail through Rust /api/v2 without list-and-find fetching', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'clinic-1',
            code: 'general',
            name: 'General Clinic',
            is_active: true,
            created_at: '2026-05-12T04:02:42Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await clinicsApi.get('clinic-1', { signal: new AbortController().signal });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/clinics/clinic-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual({
      id: 'clinic-1',
      code: 'general',
      name: 'General Clinic',
      is_active: true,
      created_at: '2026-05-12T04:02:42Z',
      booking_mode: 'clinic_pool',
      waitlist_enabled: false,
    });
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
    expect(response).toEqual(expect.arrayContaining([
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
    ]));
  });

  it('returns default unit types when Rust org units are empty', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [],
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
    expect(response.map((unitType) => unitType.code)).toEqual([
      'facility',
      'department',
      'ward',
      'clinic',
      'service',
      'administrative',
    ]);
  });

  it('creates clinical units through Rust admin org units with the V2 payload shape', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'unit-3',
            code: 'PHARM',
            name: 'Pharmacy',
            unit_type: 'service',
            is_active: true,
            parent_unit_id: 'unit-1',
            parent_unit_name: 'Clinical Services',
            created_at: '2026-05-12T04:31:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await clinicalUnitsApi.create({
      code: 'PHARM',
      name: 'Pharmacy',
      unit_type_code: 'service',
      parentId: 'unit-1',
      ignored_legacy_field: 'not-sent',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admin/org-units',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          code: 'PHARM',
          name: 'Pharmacy',
          unit_type: 'service',
          parent_unit_id: 'unit-1',
        }),
      }),
    );
    expect(response).toEqual({
      id: 'unit-3',
      code: 'PHARM',
      name: 'Pharmacy',
      unit_type: 'service',
      unit_type_code: 'service',
      unit_type_name: 'Service',
      unit_category: 'clinical',
      is_active: true,
      parent_unit_id: 'unit-1',
      parent_unit_name: 'Clinical Services',
      parentId: 'unit-1',
      created_at: '2026-05-12T04:31:00Z',
    });
  });

  it('loads org-unit detail and direct children through dedicated Rust endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'root',
              code: 'CLINICAL',
              name: 'Clinical Services',
              unit_type: 'department',
              is_active: true,
              parent_unit_id: null,
              parent_unit_name: null,
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
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'ward-1',
                code: 'MWA',
                name: 'Medical Ward A',
                unit_type: 'ward',
                is_active: true,
                parent_unit_id: 'root',
                parent_unit_name: 'Clinical Services',
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

    const detail = await clinicalUnitsApi.get('root');
    const children = await clinicalUnitsApi.children('root');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/admin/org-units/root',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/admin/org-units/root/children?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(detail).toEqual(expect.objectContaining({
      id: 'root',
      unit_type_code: 'department',
      parentId: null,
    }));
    expect(children).toEqual([
      expect.objectContaining({
        id: 'ward-1',
        parentId: 'root',
      }),
    ]);
  });

  it('loads org-unit ancestors and descendants through dedicated Rust endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'root',
                code: 'CLINICAL',
                name: 'Clinical Services',
                unit_type: 'department',
                is_active: true,
                parent_unit_id: null,
                parent_unit_name: null,
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'ward-1',
                code: 'MWA',
                name: 'Medical Ward A',
                unit_type: 'ward',
                is_active: true,
                parent_unit_id: 'root',
                parent_unit_name: 'Clinical Services',
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

    const ancestors = await clinicalUnitsApi.ancestors('ward-1');
    const descendants = await clinicalUnitsApi.descendants('root');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/admin/org-units/ward-1/ancestors?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/admin/org-units/root/descendants?limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(ancestors).toEqual([
      expect.objectContaining({
        id: 'root',
        unit_type_code: 'department',
        parentId: null,
      }),
    ]);
    expect(descendants).toEqual([
      expect.objectContaining({
        id: 'ward-1',
        unit_type_code: 'ward',
        parentId: 'root',
      }),
    ]);
  });

  it('does not call legacy Django endpoints for unsupported Rust V2 organization lists', async () => {
    await expect(leadershipRolesApi.list()).resolves.toEqual([]);
    await expect(departmentDutyTypesApi.list()).resolves.toEqual([]);
    await expect(clinicSchedulesApi.list()).resolves.toEqual([]);
    await expect(dutyRosterApi.onDuty()).resolves.toEqual([]);
    await expect(validationRulesApi.templates()).resolves.toEqual([]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('fails closed for unsupported Rust V2 organization mutations instead of calling Django', async () => {
    await expect(leadershipRolesApi.create({ name: 'Head Nurse' })).rejects.toThrow(
      /Rust V2 .* leadership roles/i,
    );
    await expect(rosterEntriesApi.generate('unit-1', { month: '2026-05' })).rejects.toThrow(
      /Rust V2 .* roster entries/i,
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
