import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import NhisClaimsArPage from '../NhisClaimsArPage';

describe('NHIS batch creation through the active page', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
  let queryClient;
  let batches;
  let firstPageClaims;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const page = (data, next = null) => ({ data, page: { limit: 25, has_next: Boolean(next), next_cursor: next }, meta: {} });
  const claim = (id, status = 'draft', currency = 'GHS') => ({ id, claim_number: id, invoice_id: `invoice-${id}`, patient_id: 'synthetic-patient', patient_code: 'SYNTHETIC', status, amount_minor: 8000, currency, created_at: '2026-10-15T10:00:00Z' });
  beforeEach(() => {
    batches = [];
    firstPageClaims = [claim('DRAFT-PAGE-1'), claim('TERMINAL', 'submitted')];
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    globalThis.fetch = vi.fn(async (url, request = {}) => {
      const target = new URL(url);
      if (target.pathname.endsWith('/nhis/batches')) {
        if (request.method === 'POST') {
          const saved = { id: 'saved-batch', batch_number: 'SAVED-BATCH', claim_count: JSON.parse(request.body).claim_ids.length, total_amount_minor: 9900, currency: 'GHS', status: 'draft', created_at: '2026-10-15T10:00:00Z' };
          batches = [saved];
          return json({ data: saved });
        }
        return json(page(batches));
      }
      if (target.pathname.endsWith('/nhis/claims') || target.pathname.endsWith('/nhis/claims/search')) {
        const query = request.method === 'POST' ? JSON.parse(request.body) : Object.fromEntries(target.searchParams);
        if (query.search) return json(page([claim('SEARCH-RESULT')]));
        if (query.status === 'ready') return json(page([claim('READY-CLAIM', 'ready')]));
        if (query.cursor === 'claims-page-2') return json(page([claim('DRAFT-PAGE-2')]));
        return json(page(firstPageClaims, 'claims-page-2'));
      }
      if (target.pathname.endsWith('/nhis/exports') || target.pathname.endsWith('/nhis/remittance-imports') || target.pathname.endsWith('/billing/insurance-providers')) return json(page([]));
      throw new Error('Unexpected NHIS batch test request');
    });
    __resetV2ApiClientForTests();
    configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS' });
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(() => {
    queryClient.clear();
    globalThis.fetch = originalFetch;
    window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
    __resetV2ApiClientForTests();
  });
  function renderPage(canManage = true) {
    return render(<AuthContext.Provider value={{ user: { adminAccess: { capabilities: canManage ? ['nhis.claim.manage'] : [] } } }}>
      <QueryClientProvider client={queryClient}><MemoryRouter><NhisClaimsArPage /></MemoryRouter></QueryClientProvider>
    </AuthContext.Provider>);
  }
  async function open() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select claims for batch' }));
    await screen.findByRole('checkbox', { name: 'Select claim DRAFT-PAGE-1' });
    return user;
  }
  function writes() {
    return globalThis.fetch.mock.calls.filter(([url, request]) => request.method === 'POST' && new URL(url).pathname.endsWith('/nhis/batches'));
  }

  it('saves only explicit current-page claims, follows the real cursor, and shows persisted batch values', async () => {
    renderPage();
    const user = await open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Select claim TERMINAL' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select claim DRAFT-PAGE-1' }));
    expect(writes()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Go to next page' }));
    await screen.findByRole('checkbox', { name: 'Select claim DRAFT-PAGE-2' });
    expect(screen.getByRole('button', { name: 'Create batch' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select claim DRAFT-PAGE-2' }));
    await user.click(screen.getByRole('button', { name: 'Create batch' }));
    const saved = await screen.findByRole('status');
    expect(saved).toHaveTextContent('SAVED-BATCH');
    expect(saved).toHaveTextContent('99.00');
    expect(saved).toHaveTextContent('has not been submitted to NHIS');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ claim_ids: ['DRAFT-PAGE-2'] });
    expect(globalThis.fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('cursor') === 'claims-page-2')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByText('SAVED-BATCH');
    expect(screen.queryByRole('button', { name: 'Lint' })).not.toBeInTheDocument();
  });

  it('requires dedicated permission before exposing create', async () => {
    renderPage(false);
    await screen.findByText(/creating batches requires nhis claims management permission/i);
    expect(screen.queryByRole('button', { name: 'Select claims for batch' })).not.toBeInTheDocument();
  });

  it('clears selection and cursor when changing status or search', async () => {
    renderPage();
    const user = await open();
    const dialog = screen.getByRole('dialog');
    await user.click(screen.getByRole('checkbox', { name: 'Select claim DRAFT-PAGE-1' }));
    const status = screen.getByRole('combobox', { name: 'Claim status' });
    status.focus();
    await user.keyboard('[ArrowDown]');
    await user.click(await screen.findByRole('option', { name: 'Ready' }));
    await screen.findByRole('checkbox', { name: 'Select claim READY-CLAIM' });
    expect(screen.getByRole('button', { name: 'Create batch' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select claim READY-CLAIM' }));
    await user.type(screen.getByLabelText('Find claims'), 'synthetic');
    expect(screen.getByRole('button', { name: 'Create batch' })).toBeDisabled();
    await within(dialog).findByRole('checkbox', { name: 'Select claim SEARCH-RESULT' });
    const searches = globalThis.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/nhis/claims/search'));
    expect(JSON.parse(searches.at(-1)[1].body)).toEqual({ limit: 25, cursor: null, status: 'ready', search: 'synthetic' });
    expect(screen.getByRole('button', { name: 'Create batch' })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it('blocks mixed-currency selection and does not send a batch', async () => {
    firstPageClaims = [claim('GHS-CLAIM'), claim('USD-CLAIM', 'draft', 'USD')];
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select claims for batch' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Select all eligible claims on this page' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose claims with the same currency.');
    expect(screen.getByRole('button', { name: 'Create batch' })).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it('locks duplicate submission and dismissal until the single pending save completes', async () => {
    renderPage();
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Select claim DRAFT-PAGE-1' }));
    const original = globalThis.fetch.getMockImplementation();
    let finish;
    globalThis.fetch.mockImplementation((url, request = {}) => {
      if (request.method === 'POST' && new URL(url).pathname.endsWith('/nhis/batches')) return new Promise((resolve) => { finish = () => resolve(original(url, request)); });
      return original(url, request);
    });
    const form = screen.getByRole('button', { name: 'Create batch' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByRole('button', { name: 'Creating…' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    finish();
    expect(await screen.findByRole('status')).toHaveTextContent('Batch saved');
  });

  it('does not offer an identical retry when the create response is lost', async () => {
    renderPage();
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Select claim DRAFT-PAGE-1' }));
    const original = globalThis.fetch.getMockImplementation();
    globalThis.fetch.mockImplementation((url, request = {}) => request.method === 'POST' && new URL(url).pathname.endsWith('/nhis/batches') ? Promise.reject(new TypeError('Lost response')) : original(url, request));
    await user.click(screen.getByRole('button', { name: 'Create batch' }));
    await screen.findByText('Save status unknown');
    expect(screen.getByRole('button', { name: 'Create batch' })).toBeDisabled();
    expect(writes()).toHaveLength(1);
  });

  it('shows an authoritative eligibility conflict without claiming a saved batch', async () => {
    renderPage();
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Select claim DRAFT-PAGE-1' }));
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'nhis_batch_claims_already_batched', message: 'One or more claims already belong to a batch.' } }, 409));
    await user.click(screen.getByRole('button', { name: 'Create batch' }));
    await screen.findByText('One or more claims already belong to a batch.');
    expect(screen.getByText('Batch not saved')).toBeInTheDocument();
    expect(screen.queryByText('Batch saved')).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  });

  it('preserves the saved confirmation through failed batch refresh and blocks another create until a fresh read', async () => {
    renderPage();
    const user = await open();
    await user.click(screen.getByRole('checkbox', { name: 'Select claim DRAFT-PAGE-1' }));
    const original = globalThis.fetch.getMockImplementation();
    let saved = false;
    let fail = true;
    globalThis.fetch.mockImplementation((url, request = {}) => {
      if (request.method === 'POST' && new URL(url).pathname.endsWith('/nhis/batches')) { saved = true; return original(url, request); }
      if (saved && fail && new URL(url).pathname.endsWith('/nhis/batches')) return Promise.resolve(json({ error: { message: 'Refresh unavailable.' } }, 503));
      return original(url, request);
    });
    await user.click(screen.getByRole('button', { name: 'Create batch' }));
    expect(await screen.findByRole('status')).toHaveTextContent('SAVED-BATCH');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByText('NHIS records could not be refreshed');
    expect(screen.getByRole('button', { name: 'Select claims for batch' })).toBeDisabled();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry NHIS refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select claims for batch' })).toBeEnabled());
    expect(writes()).toHaveLength(1);
  });
});
