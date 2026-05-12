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

  it('builds dashboard metrics from bounded Rust V2 billing lists', async () => {
    const today = new Date().toISOString();
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'invoice-1',
              patient_id: 'patient-1',
              patient_code: 'P-0001',
              invoice_number: 'INV-1',
              status: 'issued',
              gross_amount_minor: 10000,
              paid_amount_minor: 4000,
              balance_minor: 6000,
              currency: 'GHS',
              issued_at: today,
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'payment-1',
              invoice_id: 'invoice-1',
              receipt_number: 'RCT-1',
              amount_minor: 4000,
              currency: 'GHS',
              method: 'cash',
              status: 'recorded',
              paid_at: today,
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'claim-1',
              invoice_id: 'invoice-1',
              patient_id: 'patient-1',
              patient_code: 'P-0001',
              claim_number: 'CLM-1',
              status: 'ready',
              amount_minor: 3000,
              currency: 'GHS',
              created_at: today,
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      );

    const metrics = await billingApi.getDashboardMetrics();

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/invoices?limit=100',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/payments?limit=100',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nhis/claims?limit=100',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(metrics).toEqual(
      expect.objectContaining({
        revenue_today: 40,
        revenue_this_week: 40,
        outstanding_amount: 60,
        outstanding_invoices: 1,
        pending_claims: 1,
        pending_claims_amount: 30,
        invoices_created_today: 1,
        payments_received_today: 1,
        unique_patients_billed: 1,
        average_invoice_amount: 100,
      }),
    );
  });

  it('loads recent dashboard activity from Rust V2 invoices and payments', async () => {
    const now = '2026-05-12T08:00:00Z';
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'invoice-1',
              patient_id: 'patient-1',
              patient_code: 'P-0001',
              invoice_number: 'INV-1',
              status: 'issued',
              gross_amount_minor: 10000,
              paid_amount_minor: 4000,
              balance_minor: 6000,
              currency: 'GHS',
              issued_at: now,
            },
          ],
          page: { limit: 5, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'payment-1',
              invoice_id: 'invoice-1',
              receipt_number: 'RCT-1',
              amount_minor: 4000,
              currency: 'GHS',
              method: 'cash',
              status: 'recorded',
              paid_at: now,
            },
          ],
          page: { limit: 5, has_next: false, next_cursor: null },
          meta: {},
        }),
      );

    const invoices = await billingApi.getRecentInvoices({ limit: 5 });
    const payments = await billingApi.getRecentPayments({ limit: 5 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/invoices?limit=5',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/payments?limit=5',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(invoices).toEqual([
      expect.objectContaining({
        id: 'invoice-1',
        patient_name: 'P-0001',
        total_amount: 100,
        balance_due: 60,
      }),
    ]);
    expect(payments).toEqual([
      expect.objectContaining({
        id: 'payment-1',
        payment_method: 'cash',
        payment_date: now,
        amount: 40,
      }),
    ]);
  });

  it('loads billing settings and current cash session from Rust V2 cash controls', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'drawer-1', code: 'MAIN', name: 'Main Drawer', active: true }],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'session-1',
              drawer_id: 'drawer-1',
              drawer_code: 'MAIN',
              opened_by_user_id: 'user-1',
              status: 'open',
              opening_float_minor: 2500,
              expected_cash_minor: 6500,
              counted_cash_minor: null,
              variance_minor: null,
              currency: 'GHS',
              opened_at: '2026-05-12T08:00:00Z',
              closed_at: null,
            },
          ],
          page: { limit: 10, has_next: false, next_cursor: null },
          meta: {},
        }),
      );

    const settings = await billingApi.getFacilityBillingSettings();
    const current = await billingApi.getCurrentCashSession();

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/cash-drawers',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/cash-sessions?limit=10',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(settings).toEqual([
      expect.objectContaining({
        cash_control_enabled: true,
      }),
    ]);
    expect(current).toEqual({
      session: expect.objectContaining({
        id: 'session-1',
        opening_float_amount: 25,
        expected_cash_amount: 65,
      }),
    });
  });
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
