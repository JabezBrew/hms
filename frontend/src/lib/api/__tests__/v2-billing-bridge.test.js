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
      'http://localhost:8080/api/v2/billing/invoices/search',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token-123',
          'X-Facility-Code': 'HMS',
        }),
        body: JSON.stringify({ limit: 25, patient_id: 'patient-1' }),
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

  it('builds dashboard metrics from the Rust V2 dashboard summary endpoint', async () => {
    const abortController = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          revenue_today_minor: 4000,
          revenue_this_week_minor: 4000,
          outstanding_amount_minor: 6000,
          outstanding_invoices: 1,
          pending_claims: 1,
          pending_claims_amount_minor: 3000,
          invoices_created_today: 1,
          payments_received_today: 1,
          unique_patients_billed: 1,
          average_invoice_amount_minor: 10000,
        },
        meta: {},
      }),
    );

    const metrics = await billingApi.getDashboardMetrics({}, { signal: abortController.signal });

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/billing/dashboard-summary',
      expect.objectContaining({
        method: 'GET',
        credentials: 'include',
        signal: abortController.signal,
      }),
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
    expect(invoices).toEqual(expect.objectContaining({
      count: 2,
      next: 'next-invoice',
      previous: null,
      results: [expect.objectContaining({ id: 'invoice-1', total_amount: 100 })],
    }));
    expect(payments.results).toEqual([
      expect.objectContaining({ id: 'payment-1', amount: 40, payment_method: 'cash' }),
    ]);
    expect(claims.results).toEqual([
      expect.objectContaining({ id: 'claim-1', claimed_amount: 30, patient_name: 'P-0001' }),
    ]);
  });

  it('sends sensitive billing search and patient filters through Rust V2 POST bodies', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: [],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }));

    await billingApi.getInvoices({ page_size: 20, search: 'Demo Patient' });
    await billingApi.getPayments({ page_size: 20, patient_id: 'patient-1' });
    await billingApi.getClaims({ page_size: 20, search: 'CLM-1', patient: 'patient-1' });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/invoices/search',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ limit: 20, cursor: null, search: 'Demo Patient' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/payments/search',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ limit: 20, cursor: null, patient_id: 'patient-1' }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nhis/claims/search',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          limit: 20,
          cursor: null,
          patient_id: 'patient-1',
          search: 'CLM-1',
        }),
      }),
    );
  });

  it('threads cached Rust V2 billing cursors into numeric page requests', async () => {
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
              issued_at: '2026-05-12T08:00:00Z',
            },
          ],
          page: { limit: 20, has_next: true, next_cursor: 'invoice-page-2' },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'invoice-2',
              patient_id: 'patient-2',
              patient_code: 'P-0002',
              invoice_number: 'INV-2',
              status: 'issued',
              gross_amount_minor: 5000,
              paid_amount_minor: 0,
              balance_minor: 5000,
              currency: 'GHS',
              issued_at: '2026-05-13T08:00:00Z',
            },
          ],
          page: { limit: 20, has_next: false, next_cursor: null },
          meta: {},
        }),
      );

    const firstPage = await billingApi.getInvoices({ page: 1, page_size: 20 });
    const secondPage = await billingApi.getInvoices({ page: 2, page_size: 20 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/invoices?limit=20',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/invoices?limit=20&cursor=invoice-page-2',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(firstPage).toEqual(expect.objectContaining({
      count_exact: false,
      next: 'invoice-page-2',
      page: 1,
    }));
    expect(secondPage).toEqual(expect.objectContaining({
      count: 21,
      count_exact: true,
      page: 2,
      previous: '1',
      results: [expect.objectContaining({ id: 'invoice-2' })],
    }));
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
          data: {
            id: 'receipt-1',
            payment_id: 'payment-1',
            invoice_id: 'invoice-1',
            receipt_number: 'RCT-1',
            amount_minor: 4000,
            currency: 'GHS',
            issued_at: issuedAt,
          },
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
          data: {
            id: 'rule-1',
            code: 'cash-required',
            name: 'Cash required',
            rule_type: 'cash_required',
            active: true,
          },
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
      'http://localhost:8080/api/v2/billing/receipts/by-number/RCT-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/nhis/claims/claim-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/billing/rules/rule-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(invoice).toEqual(expect.objectContaining({ id: 'invoice-1', total_amount: 100 }));
    expect(receipt).toEqual(expect.objectContaining({ id: 'receipt-1', receipt_number: 'RCT-1', amount: 40 }));
    expect(claim).toEqual(expect.objectContaining({ id: 'claim-1', claimed_amount: 30 }));
    expect(rule).toEqual(expect.objectContaining({ id: 'rule-1', is_active: true }));
  });

  it('loads receipt detail through Rust V2 receipt contracts without list-and-find fetching', async () => {
    const issuedAt = '2026-05-12T08:00:00Z';
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 'receipt-1',
            payment_id: 'payment-1',
            invoice_id: 'invoice-1',
            receipt_number: 'RCT-1',
            amount_minor: 4000,
            currency: 'GHS',
            issued_at: issuedAt,
          },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 'receipt-1',
            payment_id: 'payment-1',
            invoice_id: 'invoice-1',
            receipt_number: 'RCT-1',
            amount_minor: 4000,
            currency: 'GHS',
            issued_at: issuedAt,
          },
          meta: {},
        }),
      );

    const generated = await billingApi.generateReceipt('payment-1');
    const printDetail = await billingApi.getReceiptPrintDetail('receipt-1');

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/payments/payment-1/receipt',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/receipts/receipt-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(generated).toEqual(expect.objectContaining({ id: 'receipt-1', receipt_number: 'RCT-1', amount: 40 }));
    expect(printDetail).toEqual(expect.objectContaining({
      id: 'receipt-1',
      receipt_number: 'RCT-1',
      amount: 40,
      items: [],
    }));
  });

  it('loads billing rules through bounded Rust V2 filters', async () => {
    globalThis.fetch.mockResolvedValueOnce(
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
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }),
    );

    const response = await billingApi.getBillingRules(
      { page_size: 20, rule_type: 'cash_required', is_active: true },
      { signal: new AbortController().signal },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/billing/rules?limit=20&rule_type=cash_required&is_active=true',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(response.results).toEqual([
      expect.objectContaining({
        id: 'rule-1',
        rule_type: 'cash_required',
        is_active: true,
      }),
    ]);
  });

  it('routes billing write workflows through Rust V2 endpoints with abort signals', async () => {
    const signal = new AbortController().signal;

    globalThis.fetch
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'invoice-1',
          patient_id: 'patient-1',
          patient_code: 'P-0001',
          invoice_number: 'INV-1',
          status: 'issued',
          gross_amount_minor: 15000,
          paid_amount_minor: 0,
          balance_minor: 15000,
          currency: 'GHS',
          issued_at: '2026-05-12T08:00:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'payment-1',
          invoice_id: 'invoice-1',
          receipt_number: 'RCT-1',
          amount_minor: 5000,
          currency: 'GHS',
          method: 'cash',
          status: 'recorded',
          paid_at: '2026-05-12T08:05:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'claim-1',
          invoice_id: 'invoice-1',
          patient_id: 'patient-1',
          patient_code: 'P-0001',
          claim_number: 'CLM-1',
          status: 'ready',
          amount_minor: 3000,
          currency: 'GHS',
          created_at: '2026-05-12T08:10:00Z',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'session-1',
          drawer_id: 'drawer-1',
          status: 'open',
          opening_float_minor: 2500,
          expected_cash_minor: 2500,
          counted_cash_minor: null,
          variance_minor: null,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'session-1',
          drawer_id: 'drawer-1',
          status: 'closed',
          opening_float_minor: 2500,
          expected_cash_minor: 2500,
          counted_cash_minor: 2500,
          variance_minor: 0,
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'batch-1',
          batch_number: 'BATCH-1',
          status: 'draft',
          claim_count: 1,
          total_amount_minor: 3000,
          currency: 'GHS',
        },
        meta: {},
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: 'export-1',
          batch_id: 'batch-1',
          status: 'queued',
        },
        meta: {},
      }));

    await expect(billingApi.createInvoice({
      patient: 'patient-1',
      items: [{ service_price_id: 'price-1', quantity: 2 }],
    }, { signal })).resolves.toMatchObject({ id: 'invoice-1', total_amount: 150 });
    await expect(billingApi.recordPayment('invoice-1', {
      amount: 50,
      payment_method: 'cash',
      cash_session_id: 'session-1',
    }, { signal })).resolves.toMatchObject({ id: 'payment-1', amount: 50 });
    await expect(billingApi.generateClaim('invoice-1', { signal })).resolves.toMatchObject({
      id: 'claim-1',
      claimed_amount: 30,
    });
    await expect(billingApi.openCashSession({
      drawer_id: 'drawer-1',
      opening_float_amount: 25,
    }, { signal })).resolves.toMatchObject({ id: 'session-1', opening_float_amount: 25 });
    await expect(billingApi.closeCashSession('session-1', {
      counted_cash_amount: 25,
    }, { signal })).resolves.toMatchObject({ id: 'session-1', counted_cash_amount: 25 });
    await expect(billingApi.createNhisClaimBatch({
      claim_ids: ['claim-1'],
    }, { signal })).resolves.toMatchObject({ id: 'batch-1', total_amount: 30 });
    await expect(billingApi.exportNhisClaimBatch('batch-1', {}, { signal })).resolves.toEqual({
      id: 'export-1',
      batch_id: 'batch-1',
      status: 'queued',
    });

    expect(globalThis.fetch.mock.calls.map(([url, init]) => [url, init.method, init.body, init.signal])).toEqual([
      [
        'http://localhost:8080/api/v2/billing/invoices',
        'POST',
        JSON.stringify({
          patient_id: 'patient-1',
          service_price_id: 'price-1',
          quantity: 2,
        }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/billing/payments',
        'POST',
        JSON.stringify({
          invoice_id: 'invoice-1',
          amount_minor: 5000,
          method: 'cash',
          cash_session_id: 'session-1',
        }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/nhis/claims',
        'POST',
        JSON.stringify({ invoice_id: 'invoice-1' }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/billing/cash-sessions',
        'POST',
        JSON.stringify({
          drawer_id: 'drawer-1',
          opening_float_minor: 2500,
        }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/billing/cash-sessions/session-1/close',
        'POST',
        JSON.stringify({ counted_cash_minor: 2500 }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/nhis/batches',
        'POST',
        JSON.stringify({ claim_ids: ['claim-1'] }),
        signal,
      ],
      [
        'http://localhost:8080/api/v2/nhis/batches/batch-1/export',
        'POST',
        undefined,
        signal,
      ],
    ]);
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
    await expect(billingApi.createPatientInsurance({ patient: 'patient-1' })).rejects.toThrow(
      /Rust V2 .* patient insurance mutations/i,
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('loads billing services and synthesizes service categories from Rust V2 catalog data', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'service-1',
            code: 'CONS-GEN',
            name: 'General Consultation',
            service_kind: 'consultation',
            active: true,
            active_price_id: 'price-1',
            active_price_amount_minor: 7500,
            active_price_currency: 'GHS',
          },
        ],
        page: { limit: 100, has_next: false, next_cursor: null },
        meta: {},
      }),
    );

    const services = await billingApi.getServices({ page_size: 200, is_active: true });
    const categories = await billingApi.getServiceCategories({ page_size: 200 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/service-catalog?limit=100&is_active=true',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
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
    expect(categories.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'consultation', name: 'Consultation', is_active: true }),
      expect.objectContaining({ id: 'laboratory', name: 'Laboratory', is_active: true }),
    ]));
  });

  it('loads PSP and NHIS auxiliary table read models through Rust V2', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'intent-1',
              invoice_id: 'invoice-1',
              invoice_number: 'INV-1',
              provider: 'hubtel',
              provider_reference: 'PSP-1',
              client_reference: 'INV-1',
              status: 'succeeded',
              payment_method: 'mobile_money',
              amount_minor: 12000,
              currency: 'GHS',
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
              id: 'settlement-1',
              provider: 'hubtel',
              statement_date: '2026-05-12',
              file_name: 'settlement.csv',
              status: 'ready',
              line_count: 2,
              created_at: '2026-05-12T09:00:00Z',
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
              id: 'settlement-line-1',
              batch_id: 'settlement-1',
              provider_reference: 'PSP-1',
              client_reference: 'INV-1',
              amount_gross_minor: 12000,
              fee_amount_minor: 250,
              amount_net_minor: 11750,
              paid_at: '2026-05-12T09:30:00Z',
              status: 'paid',
              match_status: 'matched',
              mismatch_reason: null,
              created_at: '2026-05-12T09:00:00Z',
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
              id: 'export-1',
              batch_id: 'batch-1',
              batch: 'BATCH-1',
              batch_number: 'BATCH-1',
              status: 'ready',
              checksum: 'abc123',
              created_at: '2026-05-12T10:00:00Z',
              expires_at: '2026-05-19T10:00:00Z',
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
              id: 'remittance-line-1',
              import_id: 'remit-1',
              claim_number: 'CLM-1',
              invoice_number: 'INV-1',
              paid_amount_minor: 9000,
              paid_date: '2026-05-12',
              match_status: 'matched',
              mismatch_reason: null,
              created_at: '2026-05-12T11:00:00Z',
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
              id: 'mapping-1',
              payer_id: 'provider-1',
              service_id: 'service-1',
              service_code: 'CONS-GEN',
              service_name: 'General Consultation',
              nhis_code: 'NHIS-CONS',
              version_number: 1,
              effective_from: '2026-01-01',
              effective_until: null,
              active: true,
              created_at: '2026-05-12T12:00:00Z',
            },
          ],
          page: { limit: 20, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 'mapping-2',
            payer_id: 'provider-1',
            service_id: 'service-1',
            service_code: 'CONS-GEN',
            service_name: 'General Consultation',
            nhis_code: 'NHIS-CONS-2',
            version_number: 2,
            effective_from: '2026-02-01',
            effective_until: null,
            active: true,
            created_at: '2026-05-13T12:00:00Z',
          },
          meta: {},
        }),
      );

    const paymentIntents = await billingApi.getPaymentIntents({ page_size: 20, status: 'succeeded' });
    const settlements = await billingApi.getSettlementBatches({ page_size: 20, status: 'ready' });
    const settlementLines = await billingApi.getSettlementLines('settlement-1', {
      page_size: 20,
      match_status: 'matched',
    });
    const exports = await billingApi.getNhisExportJobs({ page_size: 20 });
    const remittanceLines = await billingApi.getRemittanceLines('remit-1', {
      page_size: 20,
      match_status: 'matched',
    });
    const mappings = await billingApi.getPayerServiceCodes({
      page_size: 20,
      search: 'CONS',
      is_active: 'active',
      payer: 'provider-1',
    });
    const createdMapping = await billingApi.createPayerServiceCode({
      payer: 'provider-1',
      service: 'service-1',
      external_code: 'NHIS-CONS-2',
      effective_from: '2026-02-01',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/payment-intents?limit=20&status=succeeded',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/settlements?limit=20&status=ready',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/billing/settlements/settlement-1/lines?limit=20&match_status=matched',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8080/api/v2/nhis/exports?limit=20',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      'http://localhost:8080/api/v2/nhis/remittance-imports/remit-1/lines?limit=20&match_status=matched',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      6,
      'http://localhost:8080/api/v2/nhis/service-mappings?limit=20&search=CONS&active=true&payer_id=provider-1',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      7,
      'http://localhost:8080/api/v2/nhis/service-mappings',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          payer_id: 'provider-1',
          service_id: 'service-1',
          nhis_code: 'NHIS-CONS-2',
          effective_from: '2026-02-01',
          effective_until: null,
        }),
      }),
    );
    expect(paymentIntents.results).toEqual([
      expect.objectContaining({ id: 'intent-1', amount: 120, invoice: 'invoice-1' }),
    ]);
    expect(settlements.results).toEqual([
      expect.objectContaining({ id: 'settlement-1', lines_count: 2 }),
    ]);
    expect(settlementLines.results).toEqual([
      expect.objectContaining({ id: 'settlement-line-1', amount_gross: 120, fee_amount: 2.5, amount_net: 117.5 }),
    ]);
    expect(exports.results).toEqual([
      expect.objectContaining({ id: 'export-1', batch: 'BATCH-1' }),
    ]);
    expect(remittanceLines.results).toEqual([
      expect.objectContaining({ id: 'remittance-line-1', paid_amount: 90 }),
    ]);
    expect(mappings.results).toEqual([
      expect.objectContaining({
        id: 'mapping-1',
        payer: 'provider-1',
        service: 'service-1',
        external_code: 'NHIS-CONS',
        is_active: true,
      }),
    ]);
    expect(createdMapping).toEqual(expect.objectContaining({
      id: 'mapping-2',
      external_code: 'NHIS-CONS-2',
      is_active: true,
    }));
  });

  it('uses V2-safe empty shapes for billing summary surfaces that do not have Rust contracts yet', async () => {
    const [aging, dso, queue] = await Promise.all([
      billingApi.getInsuranceAging(),
      billingApi.getInsuranceDSO(),
      billingApi.getRemittanceQueue(),
    ]);

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(aging).toEqual({ bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0, total: 0 });
    expect(dso).toEqual({ dso_days: null, total_balance: 0 });
    expect(queue).toEqual({ summary: [] });
  });

  it('loads insurance providers, plans, and patient policies through Rust V2 read endpoints', async () => {
    globalThis.fetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'provider-1',
              code: 'NHIS',
              name: 'National Health Insurance',
              payer_type: 'public',
              is_active: true,
            },
          ],
          page: { limit: 200, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'plan-1',
              provider_id: 'provider-1',
              provider_name: 'National Health Insurance',
              code: 'NHIS-STD',
              name: 'NHIS Standard',
              plan_type: 'public',
              is_active: true,
            },
          ],
          page: { limit: 200, has_next: false, next_cursor: null },
          meta: {},
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 'insurance-1',
              patient_id: 'patient-1',
              patient_name: 'Demo Patient',
              patient_code: 'P-0001',
              plan_id: 'plan-1',
              plan_name: 'NHIS Standard',
              provider_id: 'provider-1',
              provider_name: 'National Health Insurance',
              policy_number: 'POL-1',
              member_id: 'MEM-1',
              subscriber_number: 'SUB-1',
              valid_from: '2026-01-01',
              valid_until: null,
              is_active: true,
            },
          ],
          page: { limit: 20, has_next: false, next_cursor: null },
          meta: {},
        }),
      );

    const providers = await billingApi.getInsuranceProviders({ page_size: 200, search: 'National' });
    const plans = await billingApi.getInsurancePlans({ page_size: 200, provider: 'provider-1', is_active: 'active' });
    const insurances = await billingApi.getPatientInsurances({ page_size: 20, search: 'POL-1', is_active: true });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/api/v2/billing/insurance-providers?limit=100&search=National',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/v2/billing/insurance-plans?limit=100&provider_id=provider-1&is_active=true',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8080/api/v2/billing/patient-insurances/search',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ limit: 20, cursor: null, search: 'POL-1', is_active: true }),
      }),
    );
    expect(providers.results).toEqual([
      expect.objectContaining({ id: 'provider-1', name: 'National Health Insurance', is_active: true }),
    ]);
    expect(plans.results).toEqual([
      expect.objectContaining({ id: 'plan-1', provider_name: 'National Health Insurance', is_active: true }),
    ]);
    expect(insurances.results).toEqual([
      expect.objectContaining({ id: 'insurance-1', patient_name: 'Demo Patient', policy_number: 'POL-1' }),
    ]);
  });

  it('sends patient insurance patient scope through a Rust V2 POST body', async () => {
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse({
        data: [],
        page: { limit: 20, has_next: false, next_cursor: null },
        meta: {},
      }),
    );

    await billingApi.getPatientInsurance('patient-1', { page_size: 20 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/billing/patient-insurances/search',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ limit: 20, cursor: null, patient_id: 'patient-1' }),
      }),
    );
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
          page: { limit: 1, has_next: false, next_cursor: null },
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
      'http://localhost:8080/api/v2/billing/cash-sessions?status=open&limit=1',
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

  it('loads cash session totals from the Rust V2 cash-session detail endpoint', async () => {
    const controller = new AbortController();
    globalThis.fetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
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
        meta: {},
      }),
    );

    await expect(billingApi.getCashSessionTotals('session-1', { signal: controller.signal })).resolves.toEqual({
      expected_cash_amount: 65,
      opening_float_amount: 25,
      counted_cash_amount: null,
      variance_amount: null,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:8080/api/v2/billing/cash-sessions/session-1',
      expect.objectContaining({ method: 'GET', credentials: 'include', signal: controller.signal }),
    );
  });
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
