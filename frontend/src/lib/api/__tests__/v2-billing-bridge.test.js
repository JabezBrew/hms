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

  it('loads invoice, payment, and claim list pages through Rust V2 bounded endpoints', async () => {
    const issuedAt = '2026-05-12T08:00:00Z';
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
              issued_at: issuedAt,
            },
          ],
          page: { limit: 20, has_next: true, next_cursor: 'next-invoice' },
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
              paid_at: issuedAt,
            },
          ],
          page: { limit: 20, has_next: false, next_cursor: null },
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
              created_at: issuedAt,
            },
          ],
          page: { limit: 20, has_next: false, next_cursor: null },
          meta: {},
        }),
      );

    const invoices = await billingApi.getInvoices({ page_size: 20 });
    const payments = await billingApi.getPayments({ page_size: 20 });
    const claims = await billingApi.getClaims({ page_size: 20 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/invoices?limit=20',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/payments?limit=20',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nhis/claims?limit=20',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(invoices).toEqual({
      count: 2,
      next: 'next-invoice',
      previous: null,
      results: [expect.objectContaining({ id: 'invoice-1', total_amount: 100 })],
    });
    expect(payments.results).toEqual([
      expect.objectContaining({ id: 'payment-1', amount: 40, payment_method: 'cash' }),
    ]);
    expect(claims.results).toEqual([
      expect.objectContaining({ id: 'claim-1', claimed_amount: 30, patient_name: 'P-0001' }),
    ]);
  });

  it('loads NHIS batches and remittance imports through Rust V2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'batch-1',
              batch_number: 'BATCH-1',
              status: 'exported',
              claim_count: 2,
              total_amount_minor: 25000,
              currency: 'GHS',
              exported_at: '2026-05-12T08:30:00Z',
              created_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 20, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'remit-1',
              batch_id: 'batch-1',
              reference: 'REM-1',
              status: 'imported',
              total_paid_minor: 20000,
              currency: 'GHS',
              imported_at: '2026-05-12T09:00:00Z',
            },
          ],
          page: { limit: 20, has_next: false, next_cursor: null },
          meta: {},
        }),
      );

    const batches = await billingApi.getNhisClaimBatches({ page_size: 20 });
    const remittances = await billingApi.getRemittanceImportJobs({ page_size: 20 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/nhis/batches?limit=20',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/nhis/remittance-imports?limit=20',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(batches.results).toEqual([
      expect.objectContaining({
        id: 'batch-1',
        batch_number: 'BATCH-1',
        total_claimed_amount: 250,
        total_amount: 250,
      }),
    ]);
    expect(remittances.results).toEqual([
      expect.objectContaining({
        id: 'remit-1',
        file_name: 'REM-1',
        total_paid: 200,
      }),
    ]);
  });

  it('loads billing invoice detail through Rust detail contract without list-and-find fetching', async () => {
    const issuedAt = '2026-05-12T08:00:00Z';
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 'invoice-1',
            patient_id: 'patient-1',
            patient_code: 'P-0001',
            invoice_number: 'INV-1',
            status: 'issued',
            gross_amount_minor: 10000,
            paid_amount_minor: 4000,
            balance_minor: 6000,
            currency: 'GHS',
            issued_at: issuedAt,
          },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'receipt-1',
              payment_id: 'payment-1',
              invoice_id: 'invoice-1',
              receipt_number: 'RCT-1',
              amount_minor: 4000,
              currency: 'GHS',
              issued_at: issuedAt,
            },
          ],
          page: { limit: 100, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 'claim-1',
            invoice_id: 'invoice-1',
            patient_id: 'patient-1',
            patient_code: 'P-0001',
            claim_number: 'CLM-1',
            status: 'ready',
            amount_minor: 3000,
            currency: 'GHS',
            created_at: issuedAt,
          },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'rule-1',
              code: 'cash-required',
              name: 'Cash required',
              rule_type: 'cash_required',
              active: true,
            },
          ],
          meta: {},
        }),
      );

    const invoice = await billingApi.getInvoice('invoice-1');
    const receipt = await billingApi.getReceiptByNumber('RCT-1');
    const claim = await billingApi.getClaim('claim-1');
    const rule = await billingApi.getBillingRule('rule-1');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/invoices/invoice-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/receipts?limit=100',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nhis/claims/claim-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/billing/rules',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(invoice).toEqual(expect.objectContaining({ id: 'invoice-1', total_amount: 100 }));
    expect(receipt).toEqual(expect.objectContaining({ id: 'receipt-1', receipt_number: 'RCT-1', amount: 40 }));
    expect(claim).toEqual(expect.objectContaining({ id: 'claim-1', claimed_amount: 30 }));
    expect(rule).toEqual(expect.objectContaining({ id: 'rule-1', is_active: true }));
  });

  it('fails closed for unsupported Rust V2 billing mutations and downloads instead of calling Django', async () => {
    await expect(billingApi.updateInvoice('invoice-1', { status: 'void' })).rejects.toThrow(
      /Rust V2 .* invoice updates/i,
    );
    await expect(billingApi.createPaymentIntent({ invoice: 'invoice-1' })).rejects.toThrow(
      /Rust V2 .* payment intents/i,
    );
    await expect(billingApi.reviewCashSession('session-1', { approved: true })).rejects.toThrow(
      /Rust V2 .* cash session review/i,
    );
    await expect(billingApi.updateClaimStatus('claim-1', { status: 'submitted' })).rejects.toThrow(
      /Rust V2 .* claim status/i,
    );
    await expect(billingApi.downloadNhisExportJob('job-1')).rejects.toThrow(
      /Rust V2 .* NHIS export downloads/i,
    );
    await expect(billingApi.createService({ name: 'Consultation' })).rejects.toThrow(
      /Rust V2 .* service catalog mutations/i,
    );
    await expect(billingApi.createPayerServiceCode({ code: 'A1' })).rejects.toThrow(
      /Rust V2 .* payer service code mutations/i,
    );
    await expect(billingApi.createPatientInsurance({ patient: 'patient-1' })).rejects.toThrow(
      /Rust V2 .* patient insurance mutations/i,
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('loads billing services and synthesizes service categories from Rust V2 catalog data', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'service-1',
              code: 'CONS-GEN',
              name: 'General Consultation',
              service_kind: 'consultation',
              active: true,
            },
          ],
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'price-1',
              service_id: 'service-1',
              service_code: 'CONS-GEN',
              service_name: 'General Consultation',
              amount_minor: 7500,
              currency: 'GHS',
              active: true,
            },
          ],
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'service-1',
              code: 'CONS-GEN',
              name: 'General Consultation',
              service_kind: 'consultation',
              active: true,
            },
          ],
          meta: {},
        }),
      );

    const services = await billingApi.getServices({ page_size: 200, is_active: true });
    const categories = await billingApi.getServiceCategories({ page_size: 200 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/service-catalog',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/service-prices',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/billing/service-catalog',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(services.results).toEqual([
      expect.objectContaining({
        id: 'service-1',
        service_price_id: 'price-1',
        category: 'consultation',
        category_name: 'Consultation',
        base_price: 75,
        is_active: true,
      }),
    ]);
    expect(categories.results).toEqual([
      expect.objectContaining({ id: 'consultation', name: 'Consultation', is_active: true }),
    ]);
  });

  it('uses V2-safe empty shapes for billing surfaces that do not have Rust contracts yet', async () => {
    const [paymentIntents, settlements, exports, aging, dso, queue, providers, plans, insurances] = await Promise.all([
      billingApi.getPaymentIntents({ page_size: 20 }),
      billingApi.getSettlementBatches({ page_size: 20 }),
      billingApi.getNhisExportJobs({ page_size: 20 }),
      billingApi.getInsuranceAging(),
      billingApi.getInsuranceDSO(),
      billingApi.getRemittanceQueue(),
      billingApi.getInsuranceProviders({ page_size: 200 }),
      billingApi.getInsurancePlans({ page_size: 200 }),
      billingApi.getPatientInsurances({ page_size: 20 }),
    ]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(paymentIntents).toEqual({ count: 0, next: null, previous: null, results: [] });
    expect(settlements).toEqual({ count: 0, next: null, previous: null, results: [] });
    expect(exports).toEqual({ count: 0, next: null, previous: null, results: [] });
    expect(aging).toEqual({ bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0, total: 0 });
    expect(dso).toEqual({ dso_days: null, total_balance: 0 });
    expect(queue).toEqual({ summary: [] });
    expect(providers).toEqual({ count: 0, next: null, previous: null, results: [] });
    expect(plans).toEqual({ count: 0, next: null, previous: null, results: [] });
    expect(insurances).toEqual({ count: 0, next: null, previous: null, results: [] });
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
