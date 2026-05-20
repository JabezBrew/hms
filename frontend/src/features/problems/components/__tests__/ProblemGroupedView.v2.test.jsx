import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProblemGroupedView from '../ProblemGroupedView';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

describe('ProblemGroupedView Rust V2 bridge', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntimeConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;
  let queryClient;

  function renderView() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ProblemGroupedView patientId="patient-1" />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
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
    queryClient.clear();
    __resetV2ApiClientForTests();
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalRuntimeConfig;
    globalThis.fetch = originalFetch;
  });

  it('renders grouped problem cards from Rust patient problems without calling the legacy grouped endpoint', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'problem-1',
              patient_id: 'patient-1',
              label: 'Hypertension',
              status: 'active',
              onset_date: null,
              created_at: '2026-05-12T08:00:00Z',
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

    renderView();

    await waitFor(() => expect(screen.getByText('Hypertension')).toBeInTheDocument());

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/patients/patient-1/clinical/problems?limit=50',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(screen.getByText('No documentation linked yet.')).toBeInTheDocument();
  });
});
