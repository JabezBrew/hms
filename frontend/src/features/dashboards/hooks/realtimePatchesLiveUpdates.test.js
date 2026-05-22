import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { dashboardKeys } from '@/hooks/useDashboardQueries';
import { patchDashboardProjectionFreshness } from './realtimePatchesLiveUpdates';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe('dashboard realtime freshness patches', () => {
  it('updates projection freshness metadata without changing dashboard metrics', () => {
    const queryClient = createQueryClient();
    const key = dashboardKeys.adminV2Root({ window: 'today' });
    queryClient.setQueryData(key, {
      generated_at: '2026-05-22T11:00:00Z',
      metrics: [{ key: 'active_patients', value: 12 }],
    });

    const patched = patchDashboardProjectionFreshness(
      queryClient,
      dashboardKeys.adminV2Base(),
      {
        event_type: 'dashboard.projection_freshness',
        entity_type: 'dashboard_projection',
        entity_id: 'facility-projection',
        version: 22,
        changed_fields: ['generated_at'],
        occurred_at: '2026-05-22T12:00:00Z',
      },
      'admin',
    );

    expect(patched).toBe(true);
    expect(queryClient.getQueryData(key)).toMatchObject({
      generated_at: '2026-05-22T11:00:00Z',
      metrics: [{ key: 'active_patients', value: 12 }],
      projection_fresh_at: '2026-05-22T12:00:00Z',
      realtime_freshness: {
        event_type: 'dashboard.projection_freshness',
        entity_type: 'dashboard_projection',
        version: 22,
        occurred_at: '2026-05-22T12:00:00Z',
      },
    });
  });
});
