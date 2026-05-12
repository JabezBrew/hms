import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingApi } from '../billing';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '../v2/client';

describe('Rust V2 billing bridge', () => {
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

  it('loads patient invoices through Rust /api/v2 and adapts patient billing fields', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'invoice-1',
              patient_id: 'patient-1',
              patient_code: 'P-0001',
              invoice_number: 'INV-1',
              status: 'issued',
              gross_amount_minor: 5000,
              paid_amount_minor: 1500,
              balance_minor: 3500,
              currency: 'GHS',
              issued_at: '2026-05-12T08:00:00Z',
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

    const response = await billingApi.getPatientInvoices('patient-1', { page_size: 25 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/billing/invoices?limit=25&patient_id=patient-1',
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
        id: 'invoice-1',
        patient: 'patient-1',
        patient_id: 'patient-1',
        invoice_number: 'INV-1',
        total_amount: 50,
        amount_paid: 15,
        balance_due: 35,
        status: 'issued',
      }),
    ]);
  });

  it('preserves AbortError from Rust patient invoice calls', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(abortError);

    await expect(
      billingApi.getPatientInvoices('patient-1', {}, { signal: new AbortController().signal }),
    ).rejects.toBe(abortError);
  });
});
