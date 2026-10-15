import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import NhisClaimsArPage from '../NhisClaimsArPage';

describe('NHIS export records through the active page', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
  let queryClient;
  let status;
  let records;
  const json = (data, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'content-type': 'application/json' } });
  const page = (data) => ({ data, page: { limit: 20, has_next: false, next_cursor: null }, meta: {} });
  const saved = { batch_id: 'batch-1', batch_number: 'PERSISTED-BATCH', export_format: 'nhis_export_record_v1', claim_count: 2, total_amount_minor: 9000, checksum: 'persisted-checksum' };
  beforeEach(() => {
    status = 'draft';
    records = [];
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    globalThis.fetch = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/nhis/batches/batch-1/export')) {
        status = 'exported';
        records = [{ id: 'batch-1', batch_id: 'batch-1', batch_number: 'PERSISTED-BATCH', status: 'recorded', created_at: '2026-10-15T12:00:00Z', expires_at: null, checksum: saved.checksum }];
        return json({ data: saved });
      }
      if (path.endsWith('/nhis/batches')) return json(page([{ id: 'batch-1', batch_number: 'PREVIEW-BATCH', claim_count: 1, total_amount_minor: 8000, currency: 'GHS', status, created_at: '2026-10-15T10:00:00Z' }]));
      if (path.endsWith('/nhis/exports')) return json(page(records));
      if (path.endsWith('/nhis/remittance-imports') || path.endsWith('/billing/insurance-providers')) return json(page([]));
      throw new Error('Unexpected export record test request');
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
    render(<AuthContext.Provider value={{ user: { adminAccess: { capabilities: canManage ? ['nhis.claim.manage'] : [] } } }}><QueryClientProvider client={queryClient}><MemoryRouter><NhisClaimsArPage /></MemoryRouter></QueryClientProvider></AuthContext.Provider>);
  }
  function writes() { return globalThis.fetch.mock.calls.filter(([url, request]) => request.method === 'POST' && new URL(url).pathname.endsWith('/export')); }
  async function open(label = 'Record export') {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: label }));
    return user;
  }

  it('requires explicit confirmation, displays persisted metadata, and refreshes truthful history', async () => {
    renderPage();
    const user = await open();
    expect(writes()).toHaveLength(0);
    expect(screen.getByRole('dialog')).toHaveTextContent('Claims keep their current status');
    await user.click(screen.getByRole('button', { name: 'Save export record' }));
    const confirmation = await screen.findByRole('status');
    expect(confirmation).toHaveTextContent('PERSISTED-BATCH · 2 claims');
    expect(confirmation).toHaveTextContent('persisted-checksum');
    expect(confirmation).toHaveTextContent('have not been submitted by this action');
    expect(writes()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByRole('button', { name: 'View record' });
    await user.click(screen.getByRole('tab', { name: 'Export records' }));
    await screen.findByText('Recorded');
    expect(screen.queryByText(/expires/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/export jobs/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('loads an existing record only on explicit action without claiming a queued job', async () => {
    status = 'exported';
    renderPage();
    const user = await open('View record');
    expect(writes()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Load saved record' }));
    expect(await screen.findByRole('status')).toHaveTextContent('persisted-checksum');
    expect(writes()).toHaveLength(1);
    expect(screen.queryByText(/job created|queued/i)).not.toBeInTheDocument();
  });

  it('does not expose writes without permission or for submitted and remitted batches', async () => {
    status = 'remitted';
    renderPage();
    await screen.findByText('Remitted');
    expect(screen.queryByRole('button', { name: /record export|view record/i })).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('requires dedicated management permission before exposing an export action', async () => {
    renderPage(false);
    await screen.findByText('PREVIEW-BATCH');
    expect(screen.queryByRole('button', { name: /record export|view record/i })).not.toBeInTheDocument();
  });

  it('locks duplicate clicks and dismissal until the pending record request completes', async () => {
    renderPage();
    const user = await open();
    const original = globalThis.fetch.getMockImplementation();
    let finish;
    globalThis.fetch.mockImplementation((url, request = {}) => new URL(url).pathname.endsWith('/export') ? new Promise((resolve) => { finish = () => resolve(original(url, request)); }) : original(url, request));
    const save = screen.getByRole('button', { name: 'Save export record' });
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByRole('button', { name: 'Loading record…' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(writes()).toHaveLength(1);
    finish();
    await screen.findByRole('status');
  });

  it('preserves an unknown save outcome without offering an identical automatic retry', async () => {
    renderPage();
    const user = await open();
    const original = globalThis.fetch.getMockImplementation();
    globalThis.fetch.mockImplementation((url, request = {}) => new URL(url).pathname.endsWith('/export') ? Promise.reject(new TypeError('Lost response')) : original(url, request));
    await user.click(screen.getByRole('button', { name: 'Save export record' }));
    await screen.findByText('Record status unknown');
    expect(screen.getByRole('button', { name: 'Save export record' })).toBeDisabled();
    expect(writes()).toHaveLength(1);
    expect(globalThis.fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/nhis/batches')).length).toBeGreaterThan(1);
  });

  it('retains saved confirmation after a failed list refresh and blocks further records until refresh succeeds', async () => {
    renderPage();
    const user = await open();
    const original = globalThis.fetch.getMockImplementation();
    let fail = true;
    globalThis.fetch.mockImplementation((url, request = {}) => status === 'exported' && fail && new URL(url).pathname.endsWith('/nhis/batches') ? Promise.resolve(json({ error: { message: 'Refresh unavailable.' } }, 503)) : original(url, request));
    await user.click(screen.getByRole('button', { name: 'Save export record' }));
    expect(await screen.findByRole('status')).toHaveTextContent('PERSISTED-BATCH');
    await screen.findByText('NHIS records could not be refreshed');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Record export' })).toBeDisabled();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Retry NHIS refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'View record' })).toBeEnabled());
    expect(writes()).toHaveLength(1);
  });

  it('shows an authoritative lifecycle conflict without claiming a saved record', async () => {
    renderPage();
    const user = await open();
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'nhis_export_state_locked', message: 'Submitted and remitted batches cannot record another export.' } }, 409));
    await user.click(screen.getByRole('button', { name: 'Save export record' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Record not saved')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Submitted and remitted batches cannot record another export.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  });
});
