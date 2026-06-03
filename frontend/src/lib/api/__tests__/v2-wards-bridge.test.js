import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { wardsApi } from '../wards';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 wards bridge', () => {
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

  it('lists wards through /api/v2 and adapts Rust ward counters for the existing ward UI', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'ward-1',
              code: 'general',
              name: 'General Ward',
              status: 'active',
              active_bed_count: 20,
              occupied_bed_count: 5,
              created_at: '2026-05-12T03:12:42Z',
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

    const response = await wardsApi.getWards({ page_size: 25 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toMatchObject([
      {
        id: 'ward-1',
        code: 'general',
        name: 'General Ward',
        ward_type: 'general',
        description: '',
        total_beds: 20,
        available_beds_count: 15,
        occupied_beds_count: 5,
        occupancy_rate: 25,
        is_active: true,
        status: 'active',
        created_at: '2026-05-12T03:12:42Z',
      },
    ]);
  });

  it('searches wards with a server-side Rust V2 search parameter', async () => {
    const controller = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'ward-icu',
              code: 'ICU',
              name: 'Intensive Care Unit',
              status: 'active',
              active_bed_count: 8,
              occupied_bed_count: 4,
              created_at: '2026-05-12T03:12:42Z',
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

    const response = await wardsApi.searchWards('icu', { signal: controller.signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards?limit=50&search=icu',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      }),
    );
    expect(response).toEqual([
      expect.objectContaining({
        id: 'ward-icu',
        name: 'Intensive Care Unit',
        total_beds: 8,
        available_beds_count: 4,
      }),
    ]);
  });

  it('forwards table search through the main Rust V2 wards list', async () => {
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

    await wardsApi.getWards({ search: 'maternity' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards?limit=100&search=maternity',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('threads AbortSignal into Rust V2 ward detail reads', async () => {
    const controller = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'ward-1',
            code: 'general',
            name: 'General Ward',
            status: 'active',
            active_bed_count: 20,
            occupied_bed_count: 5,
            created_at: '2026-05-12T03:12:42Z',
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(wardsApi.getWard('ward-1', { signal: controller.signal })).resolves.toMatchObject({
      id: 'ward-1',
      total_beds: 20,
      occupied_beds_count: 5,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/ward-1',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      }),
    );
  });

  it('loads admitted ward patients through Rust ward board data for existing ward dashboards', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              admission_id: 'admission-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-001',
              patient_display_name: 'Ama Mensah',
              ward_id: 'ward-1',
              ward_name: 'General Ward',
              bed_id: 'bed-1',
              bed_code: 'G-01',
              admission_status: 'admitted',
              admitted_at: '2026-05-12T08:00:00Z',
              open_nursing_task_count: 2,
              due_medication_count: 1,
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

    const response = await wardsApi.getAdmissions({
      ward: 'ward-1',
      status: 'admitted',
      page_size: 200,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/board?limit=100&ward_id=ward-1',
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
        id: 'admission-1',
        patient_id: 'patient-1',
        status: 'admitted',
        bed: expect.objectContaining({
          id: 'bed-1',
          bed_number: 'G-01',
        }),
        patient: expect.objectContaining({
          id: 'patient-1',
          medical_record_number: 'MRN-001',
          user: expect.objectContaining({
            full_name: 'Ama Mensah',
          }),
        }),
      }),
    ]);
  });

  it('creates wards through the Rust V2 ward setup contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'ward-2',
            code: 'TEST-WARD',
            name: 'Test Ward',
            status: 'active',
            active_bed_count: 0,
            occupied_bed_count: 0,
            created_at: '2026-05-12T10:00:00Z',
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
    const ward = await wardsApi.createWard({
      code: 'TEST-WARD',
      name: 'Test Ward',
      ward_type: 'general',
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          code: 'TEST-WARD',
          name: 'Test Ward',
        }),
        signal,
      }),
    );
    expect(ward).toEqual(expect.objectContaining({
      id: 'ward-2',
      code: 'TEST-WARD',
      name: 'Test Ward',
      total_beds: 0,
      is_active: true,
    }));
  });

  it('derives Rust ward codes from preserved UI names when no explicit code field exists', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'ward-derived',
            code: 'PLAYWRIGHT-GENERAL-WARD',
            name: 'Playwright General Ward',
            status: 'active',
            active_bed_count: 0,
            occupied_bed_count: 0,
            created_at: '2026-05-12T10:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await wardsApi.createWard({
      name: 'Playwright General Ward',
      ward_type: 'general',
      total_beds: 12,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          code: 'PLAYWRIGHT-GENERAL-WARD',
          name: 'Playwright General Ward',
        }),
      }),
    );
  });

  it('updates wards through the Rust V2 ward setup contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'ward-2',
            code: 'RENAMED',
            name: 'Renamed Ward',
            status: 'inactive',
            active_bed_count: 0,
            occupied_bed_count: 0,
            created_at: '2026-05-12T10:00:00Z',
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
    const ward = await wardsApi.updateWard('ward-2', {
      ward_type: 'RENAMED',
      name: 'Renamed Ward',
      is_active: false,
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/ward-2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          code: 'RENAMED',
          name: 'Renamed Ward',
          status: 'inactive',
        }),
        signal,
      }),
    );
    expect(ward).toEqual(expect.objectContaining({
      id: 'ward-2',
      code: 'RENAMED',
      name: 'Renamed Ward',
      is_active: false,
    }));
  });

  it('updates beds through the Rust V2 ward setup contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'bed-1',
            ward_id: 'ward-1',
            section_id: 'section-2',
            bed_code: 'W-02',
            status: 'cleaning',
            created_at: '2026-05-12T09:06:00Z',
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
    const bed = await wardsApi.updateBed('bed-1', {
      section: 'section-2',
      bed_number: 'W-02',
      status: 'cleaning',
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/beds/bed-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          section_id: 'section-2',
          bed_code: 'W-02',
          status: 'cleaning',
        }),
        signal,
      }),
    );
    expect(bed).toEqual(expect.objectContaining({
      id: 'bed-1',
      bed_number: 'W-02',
      status: 'cleaning',
      is_active: true,
    }));
  });

  it('updates ward sections through the Rust V2 ward setup contract', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'section-2',
            ward_id: 'ward-1',
            code: 'WEST-RENAMED',
            name: 'Renamed West Section',
            status: 'inactive',
            active_bed_count: 3,
            created_at: '2026-05-12T09:05:00Z',
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
    const section = await wardsApi.updateSection('section-2', {
      code: 'WEST-RENAMED',
      name: 'Renamed West Section',
      is_active: false,
    }, { signal });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/sections/section-2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          code: 'WEST-RENAMED',
          name: 'Renamed West Section',
          status: 'inactive',
        }),
        signal,
      }),
    );
    expect(section).toEqual(expect.objectContaining({
      id: 'section-2',
      code: 'WEST-RENAMED',
      name: 'Renamed West Section',
      is_active: false,
    }));
  });

  it('soft-deletes ward setup resources through Rust V2 status updates', async () => {
    const controller = new AbortController();
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'ward-2',
              code: 'RENAMED',
              name: 'Renamed Ward',
              status: 'inactive',
              active_bed_count: 0,
              occupied_bed_count: 0,
              created_at: '2026-05-12T10:00:00Z',
            },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'bed-1',
              ward_id: 'ward-2',
              section_id: 'section-2',
              bed_code: 'W-02',
              status: 'closed',
              created_at: '2026-05-12T09:06:00Z',
            },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'section-2',
              ward_id: 'ward-2',
              code: 'WEST',
              name: 'West Section',
              status: 'inactive',
              active_bed_count: 0,
              created_at: '2026-05-12T09:05:00Z',
            },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    await expect(wardsApi.deleteWard('ward-2', { signal: controller.signal })).resolves.toEqual(
      expect.objectContaining({ id: 'ward-2', is_active: false }),
    );
    await expect(wardsApi.deleteBed('bed-1', { signal: controller.signal })).resolves.toEqual(
      expect.objectContaining({ id: 'bed-1', status: 'closed', is_active: false }),
    );
    await expect(wardsApi.deleteSection('section-2', { signal: controller.signal })).resolves.toEqual(
      expect.objectContaining({ id: 'section-2', is_active: false }),
    );

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body, init.signal])).toEqual([
      ['http://localhost:8080/api/v2/wards/ward-2', 'PATCH', JSON.stringify({ status: 'inactive' }), controller.signal],
      ['http://localhost:8080/api/v2/wards/beds/bed-1', 'PATCH', JSON.stringify({ status: 'closed' }), controller.signal],
      [
        'http://localhost:8080/api/v2/wards/sections/section-2',
        'PATCH',
        JSON.stringify({ status: 'inactive' }),
        controller.signal,
      ],
    ]);
  });

  it('uses Rust V2 for root metadata, scoped sections, and supported ward setup mutations', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'section-1',
                ward_id: 'ward-1',
                code: 'EAST',
                name: 'East Section',
                status: 'active',
                active_bed_count: 3,
                created_at: '2026-05-12T09:00:00Z',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'section-2',
              ward_id: 'ward-1',
              code: 'WEST',
              name: 'West Section',
              status: 'active',
              active_bed_count: 0,
              created_at: '2026-05-12T09:05:00Z',
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
            data: {
              id: 'bed-1',
              ward_id: 'ward-1',
              section_id: 'section-2',
              bed_code: 'W-01',
              status: 'available',
              created_at: '2026-05-12T09:06:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    await expect(wardsApi.getWardsRoot()).resolves.toEqual(
      expect.objectContaining({
        mode: 'rust-v2',
        resources: expect.arrayContaining(['wards', 'beds', 'sections', 'admissions']),
      }),
    );

    const sections = await wardsApi.getSections({ ward: 'ward-1', page_size: 25 });
    const createdSection = await wardsApi.createSection({
      ward: 'ward-1',
      code: 'WEST',
      name: 'West Section',
    });
    const createdBed = await wardsApi.createBed({
      ward: 'ward-1',
      section: 'section-2',
      bed_number: 'W-01',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/wards/ward-1/sections?limit=25',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/wards/ward-1/sections',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'WEST', name: 'West Section' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/wards/ward-1/beds',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ section_id: 'section-2', bed_code: 'W-01' }),
      }),
    );
    expect(sections).toEqual([
      expect.objectContaining({
        id: 'section-1',
        ward: 'ward-1',
        bed_count: 3,
        is_active: true,
      }),
    ]);
    expect(createdSection).toEqual(expect.objectContaining({ id: 'section-2', ward: 'ward-1' }));
    expect(createdBed).toEqual(expect.objectContaining({ id: 'bed-1', bed_number: 'W-01', ward: 'ward-1' }));
  });

  it('derives Rust section codes from preserved UI names when no explicit code field exists', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'section-derived',
            ward_id: 'ward-1',
            code: 'RECOVERY-BAY',
            name: 'Recovery Bay',
            status: 'active',
            active_bed_count: 0,
            created_at: '2026-05-12T09:05:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await wardsApi.createSection({
      ward: 'ward-1',
      name: 'Recovery Bay',
      accommodation_tier: 'open',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/ward-1/sections',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          code: 'RECOVERY-BAY',
          name: 'Recovery Bay',
        }),
      }),
    );
  });

  it('loads ward sections through the bounded Rust V2 section list helper', async () => {
    const controller = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'section-1',
              ward_id: 'ward-1',
              code: 'EAST',
              name: 'East Section',
              status: 'active',
              active_bed_count: 3,
              created_at: '2026-05-12T09:00:00Z',
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

    const sections = await wardsApi.getWardSections('ward-1', {
      signal: controller.signal,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/wards/ward-1/sections?limit=25',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      }),
    );
    expect(sections).toEqual([
      expect.objectContaining({
        id: 'section-1',
        ward: 'ward-1',
        is_active: true,
      }),
    ]);
  });

  it('loads active admission detail through the Rust V2 admission detail endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            admission_id: 'admission-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            ward_id: 'ward-1',
            ward_name: 'Medical Ward',
            bed_id: 'bed-1',
            bed_code: 'A1',
            admission_status: 'admitted',
            admitted_at: '2026-05-12T05:30:00Z',
          },
          meta: {},
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(wardsApi.getAdmission('admission-1')).resolves.toMatchObject({
      id: 'admission-1',
      admission_id: 'admission-1',
      patient_name: 'Ama Mensah',
      status: 'admitted',
      bed: expect.objectContaining({
        bed_number: 'A1',
        ward_id: 'ward-1',
      }),
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/admissions/admission-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('loads bed detail, section detail, and section-scoped beds through Rust V2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'bed-1',
              ward_id: 'ward-1',
              section_id: 'section-1',
              bed_code: 'E-01',
              status: 'available',
              created_at: '2026-05-12T09:10:00Z',
            },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              id: 'section-1',
              ward_id: 'ward-1',
              code: 'EAST',
              name: 'East Section',
              status: 'active',
              active_bed_count: 1,
              created_at: '2026-05-12T09:00:00Z',
            },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'bed-1',
                ward_id: 'ward-1',
                section_id: 'section-1',
                bed_code: 'E-01',
                status: 'available',
                created_at: '2026-05-12T09:10:00Z',
              },
            ],
            page: { limit: 25, has_next: false, next_cursor: null },
            meta: {},
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

    await expect(wardsApi.getBed('bed-1')).resolves.toMatchObject({
      id: 'bed-1',
      bed_number: 'E-01',
      ward: 'ward-1',
      section: 'section-1',
    });
    await expect(wardsApi.getSection('section-1')).resolves.toMatchObject({
      id: 'section-1',
      ward: 'ward-1',
      bed_count: 1,
    });
    await expect(wardsApi.getSectionBeds('section-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'bed-1',
        bed_number: 'E-01',
      }),
    ]);

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/wards/beds/bed-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/wards/sections/section-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/wards/sections/section-1/beds?limit=25',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('fails closed or returns safe empty lists for unsupported Rust V2 ward calls', async () => {
    await expect(wardsApi.updateAdmission('admission-1', { status: 'closed' })).rejects.toThrow(
      /Rust V2 .* admission updates/i,
    );
    await expect(wardsApi.createTransfer({ admission: 'admission-1' })).rejects.toThrow(
      /Rust V2 .* ward transfers/i,
    );

    await expect(wardsApi.getTransfers()).resolves.toEqual([]);
    await expect(wardsApi.getAmenities()).resolves.toEqual([]);
    await expect(wardsApi.getWardStaff('ward-1')).resolves.toEqual([]);
    await expect(wardsApi.getStaffAssignments()).resolves.toEqual([]);
    await expect(wardsApi.getStaffRoles()).resolves.toEqual([]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
