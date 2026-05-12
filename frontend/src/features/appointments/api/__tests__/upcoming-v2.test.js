import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

vi.mock('@/lib/auth-storage', () => ({
  getAuthJSON: vi.fn(),
}));

const { getAuthJSON } = await import('@/lib/auth-storage');
const { fetchUpcomingAppointments } = await import('../upcoming');

describe('Rust V2 upcoming appointments helper', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = {
      apiMode: 'rust-v2',
      v2ApiBaseUrl: 'http://localhost:8080/api/v2',
    };
    globalThis.fetch = vi.fn();
    getAuthJSON.mockReturnValue({ role: 'doctor' });
    __resetV2ApiClientForTests();
    configureV2ApiClient({
      getAccessToken: () => 'access-token-123',
      getFacilityCode: () => 'HMS',
    });
  });

  afterEach(() => {
    __resetV2ApiClientForTests();
    vi.clearAllMocks();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('loads upcoming appointments from the bounded Rust V2 list endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'appointment-1',
              patient_id: 'patient-1',
              patient_code: 'MRN-MAIN-2026-000001',
              patient_display_name: 'Ama Mensah',
              starts_at: '2026-05-12T09:00:00Z',
              ends_at: '2026-05-12T09:30:00Z',
              status: 'scheduled',
              created_at: '2026-05-11T08:00:00Z',
            },
          ],
          page: { limit: 5, has_next: false, next_cursor: null },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const appointments = await fetchUpcomingAppointments();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/appointments?limit=5',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(appointments).toEqual([
      expect.objectContaining({
        id: 'appointment-1',
        patientName: 'Ama Mensah',
        startDateTime: '2026-05-12T09:00:00Z',
        status: 'booked',
        type: 'General',
      }),
    ]);
  });

  it('keeps admin users from fetching clinician appointment reminders', async () => {
    getAuthJSON.mockReturnValue({ role: 'admin' });

    await expect(fetchUpcomingAppointments()).resolves.toEqual([]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
