import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CrossFacilitySharePanel from '../CrossFacilitySharePanel';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <CrossFacilitySharePanel
        open
        onClose={vi.fn()}
        patient={{
          id: 'patient-1',
          name: 'Ama Mensah',
          local_data: { id: 'patient-1' },
        }}
        patientIdentityId={null}
      />
    </QueryClientProvider>,
  );
}

describe('CrossFacilitySharePanel Rust V2 mode', () => {
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

  it('starts at the Rust-supported consent grant step and submits patient consent', async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: 'consent-1',
            patient_id: 'patient-1',
            patient_code: 'MRN-001',
            patient_display_name: 'Ama Mensah',
            scope: 'referral_coordination',
            purpose: 'Transfer discussion',
            status: 'active',
            created_at: '2026-05-12T09:00:00Z',
          },
          meta: {},
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    renderPanel();

    expect(screen.getAllByText('Consent Grant')).toHaveLength(2);
    expect(screen.queryByText('Referral Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Access Token')).not.toBeInTheDocument();
    expect(screen.queryByText(/MPI identity is missing/i)).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('E.g. REGIONAL-01'), 'kath');
    await user.type(
      screen.getByPlaceholderText('Document the patient consent discussion...'),
      'Transfer discussion',
    );
    await user.click(screen.getByRole('button', { name: /grant consent/i }));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/consents',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          patient_id: 'patient-1',
          scope: 'referral_coordination',
          purpose: 'Transfer discussion',
        }),
      }),
    );
  });
});
