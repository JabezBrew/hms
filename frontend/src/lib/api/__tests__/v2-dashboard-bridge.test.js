import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dashboardsApi } from '../dashboards';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 dashboard bridge', () => {
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

  function mockSnapshot() {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'snapshot-1',
            deployment_profile: 'hospital',
            generated_at: '2026-05-12T03:26:23Z',
            metrics: [
              {
                key: 'active_patients',
                label: 'Active Patients',
                value: 12,
                feature: 'patients',
                permission: 'patient.demographics.view',
              },
              {
                key: 'waiting_visits',
                label: 'Waiting Visits',
                value: 3,
                feature: 'appointments',
                permission: 'appointment.view',
              },
              {
                key: 'open_invoices',
                label: 'Open Invoices',
                value: 2,
                feature: 'billing',
                permission: 'billing.view',
              },
            ],
            navigation: { groups: [] },
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
  }

  it('adapts the Rust dashboard snapshot for the admin v2 dashboard surface', async () => {
    mockSnapshot();

    const response = await dashboardsApi.getAdminDashboardV2({ window: 'today' });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/dashboards/snapshot',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
      }),
    );
    expect(response).toMatchObject({
      kpis: {
        active_patients: { count: 12 },
        appointment_throughput: { scheduled: 3 },
        billing: { open_invoices: 2 },
      },
      section_summaries: {
        capacity: { status: 'normal' },
        workforce: { status: 'normal' },
        compliance: { status: 'normal' },
      },
      alerts_top: [],
      action_queue_top: [],
      meta: {
        generated_at: '2026-05-12T03:26:23Z',
      },
    });
  });

  it('adapts the Rust dashboard snapshot for the background critical-alert monitor', async () => {
    mockSnapshot();

    const response = await dashboardsApi.getAdminDashboard();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/dashboards/snapshot',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response).toEqual({
      urgent: {
        critical_alerts: [],
        overdue_medications: [],
      },
    });
  });
});
