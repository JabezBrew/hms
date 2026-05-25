import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { schedulingApi } from '../scheduling';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('Rust V2 scheduling bridge', () => {
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

  it('lists and creates bookable services through Rust V2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'service-1',
                code: 'general',
                name: 'General consultation',
                default_duration_minutes: 30,
                is_active: true,
                created_at: '2026-06-01T08:00:00Z',
              },
            ],
            page: { limit: 10, has_next: false, next_cursor: null },
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
              id: 'service-2',
              code: 'anc-review',
              name: 'Antenatal review',
              default_duration_minutes: 20,
              is_active: true,
              created_at: '2026-06-01T08:05:00Z',
            },
            meta: {},
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );

    const services = await schedulingApi.listServices({ limit: 10 });
    const created = await schedulingApi.createService({
      code: 'anc-review',
      name: 'Antenatal review',
      default_duration_minutes: '20',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/scheduling/services?limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/scheduling/services',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          code: 'anc-review',
          name: 'Antenatal review',
          default_duration_minutes: 20,
        }),
      }),
    );
    expect(services).toEqual([
      expect.objectContaining({ id: 'service-1', code: 'general' }),
    ]);
    expect(created).toEqual(expect.objectContaining({ id: 'service-2' }));
  });

  it('lists scheduling exceptions through Rust V2 with date filters', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'exception-1',
              session_id: 'session-1',
              starts_at: '2026-06-04T09:00:00Z',
              ends_at: '2026-06-04T10:00:00Z',
              reason: 'Practitioner unavailable',
              created_at: '2026-06-01T08:00:00Z',
            },
          ],
          page: { limit: 10, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await schedulingApi.listExceptions({
      start_date: '2026-06-04',
      end_date: '2026-06-04',
      limit: 10,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/scheduling/exceptions?start_date=2026-06-04&end_date=2026-06-04&limit=10',
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
        id: 'exception-1',
        session_id: 'session-1',
        reason: 'Practitioner unavailable',
      }),
    ]);
  });

  it('creates a scheduling exception through Rust V2', async () => {
    const payload = {
      session_id: 'session-1',
      starts_at: '2026-06-04T09:00:00Z',
      ends_at: '2026-06-04T10:00:00Z',
      reason: 'Practitioner unavailable',
    };
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'exception-1',
            ...payload,
            created_at: '2026-06-01T08:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await schedulingApi.createException(payload);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/scheduling/exceptions',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(payload),
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'Content-Type': 'application/json',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toEqual(expect.objectContaining(payload));
  });

  it('manages session templates and generation through Rust V2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'template-1',
                clinic_id: 'clinic-1',
                service_code: 'general',
                owner_type: 'clinic',
                owner_id: 'clinic-1',
                name: 'OPD Monday Wednesday afternoon',
                mode: 'capacity_block',
                weekdays: [1, 3],
                starts_on: '2026-06-01',
                ends_on: null,
                start_time: '13:00:00',
                end_time: '15:00:00',
                capacity: 4,
                allow_overbooking: false,
                overbook_limit: 0,
                is_active: true,
                created_at: '2026-06-01T08:00:00Z',
              },
            ],
            page: { limit: 10, has_next: false, next_cursor: null },
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
              id: 'template-1',
              clinic_id: 'clinic-1',
              service_code: 'general',
              owner_type: 'clinic',
              owner_id: 'clinic-1',
              name: 'OPD Monday Wednesday afternoon',
              mode: 'capacity_block',
              weekdays: [1, 3],
              starts_on: '2026-06-01',
              start_time: '13:00:00',
              end_time: '15:00:00',
              capacity: 4,
              allow_overbooking: false,
              overbook_limit: 0,
              is_active: true,
              created_at: '2026-06-01T08:00:00Z',
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
              generated_count: 2,
              skipped_count: 0,
              sessions: [
                {
                  id: 'session-1',
                  source_template_id: 'template-1',
                  clinic_id: 'clinic-1',
                  owner_type: 'clinic',
                  owner_id: 'clinic-1',
                  name: 'OPD Monday Wednesday afternoon',
                  mode: 'capacity_block',
                  starts_at: '2026-06-08T13:00:00Z',
                  ends_at: '2026-06-08T15:00:00Z',
                  capacity: 4,
                  booked_count: 0,
                  remaining_capacity: 4,
                  allow_overbooking: false,
                  overbook_limit: 0,
                  overbook_remaining: 0,
                  is_active: true,
                  created_at: '2026-06-01T08:00:00Z',
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

    const templates = await schedulingApi.listTemplates({
      clinic_id: 'clinic-1',
      service_id: 'type-general',
      limit: 10,
    });
    const created = await schedulingApi.createTemplate({
      clinic_id: 'clinic-1',
      service_id: 'type-general',
      service_code: 'general',
      name: 'OPD Monday Wednesday afternoon',
      mode: 'capacity_block',
      weekdays: [1, 3],
      starts_on: '2026-06-01',
      start_time: '13:00',
      end_time: '15:00',
      capacity: 4,
    });
    const generated = await schedulingApi.generateSessions({
      template_id: 'template-1',
      start_date: '2026-06-08',
      end_date: '2026-06-10',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/scheduling/templates?clinic_id=clinic-1&service_id=type-general&limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/scheduling/templates',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          clinic_id: 'clinic-1',
          owner_type: 'clinic',
          owner_id: 'clinic-1',
          name: 'OPD Monday Wednesday afternoon',
          mode: 'capacity_block',
          weekdays: [1, 3],
          starts_on: '2026-06-01',
          start_time: '13:00:00',
          end_time: '15:00:00',
          capacity: 4,
          allow_overbooking: false,
          overbook_limit: 0,
          service_code: 'general',
          allowed_service_ids: ['type-general'],
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/scheduling/templates/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          start_date: '2026-06-08',
          end_date: '2026-06-10',
          template_id: 'template-1',
        }),
      }),
    );
    expect(templates).toHaveLength(1);
    expect(created).toEqual(expect.objectContaining({ id: 'template-1' }));
    expect(generated).toEqual(expect.objectContaining({ generated_count: 2 }));
  });
});
