import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import MedicationHistorySlideOver from '../MedicationHistorySlideOver';

const originalFetch = globalThis.fetch;
const originalConfig = globalThis.window.__HMS_RUNTIME_CONFIG__;

describe('Rust medication history cursor controls', () => {
  beforeEach(() => {
    globalThis.window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    globalThis.fetch = vi.fn();
    __resetV2ApiClientForTests();
    configureV2ApiClient({ getAccessToken: () => 'synthetic-access', getFacilityCode: () => 'HMS' });
  });
  afterEach(() => {
    __resetV2ApiClientForTests();
    globalThis.fetch = originalFetch;
    globalThis.window.__HMS_RUNTIME_CONFIG__ = originalConfig;
  });

  it('uses the next cursor and can return to the first patient history page', async () => {
    globalThis.fetch.mockImplementation(async (url) => {
      const params = new URL(url).searchParams;
      expect(params.get('patient_id')).toBe('selected-patient');
      expect(params.get('descending')).toBe('true');
      const secondPage = params.get('cursor') === 'opaque-older';
      return new Response(JSON.stringify({
        data: [{ id: secondPage ? 'older-dose' : 'newer-dose', patient_id: 'selected-patient', admission_case_id: 'synthetic-admission',
          medication_name: secondPage ? 'Older synthetic medication' : 'Newer synthetic medication', dose: '1 tablet', route: 'oral',
          frequency: 'daily', status: 'administered', scheduled_at: '2026-05-12T10:00:00Z' }],
        page: { has_next: !secondPage, next_cursor: secondPage ? null : 'opaque-older', limit: 20 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MedicationHistorySlideOver open patient={{ id: 'selected-patient', name: 'Synthetic fixture' }} onClose={vi.fn()} /></QueryClientProvider>);
    await screen.findByText('Newer synthetic medication');
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    await screen.findByText('Older synthetic medication');
    expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled();
    expect(new URL(globalThis.fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('opaque-older');
    fireEvent.click(screen.getByRole('button', { name: 'Go to previous page' }));
    await screen.findByText('Newer synthetic medication');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeDisabled());
    client.clear();
  });

  it('shows a load failure instead of presenting unread history as empty', async () => {
    globalThis.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Unavailable' } }), {
      status: 503, headers: { 'content-type': 'application/json' },
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MedicationHistorySlideOver open patient={{ id: 'selected-patient' }} onClose={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Medication history could not be loaded');
    expect(screen.queryByText('No medication history found')).not.toBeInTheDocument();
    client.clear();
  });
});
