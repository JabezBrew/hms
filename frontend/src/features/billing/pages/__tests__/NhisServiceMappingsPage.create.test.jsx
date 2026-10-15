import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import NhisServiceMappingsPage from '../NhisServiceMappingsPage';

describe('NHIS mapping creation through the active page', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
  let queryClient;
  let mappings;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const page = (data, next = null) => ({ data, page: { limit: 20, has_next: Boolean(next), next_cursor: next }, meta: {} });
  beforeEach(() => {
    mappings = [];
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    globalThis.fetch = vi.fn(async (url, request = {}) => {
      const target = new URL(url);
      if (target.pathname.endsWith('/billing/insurance-providers')) {
        return json(page([{ id: 'payer-1', name: 'NHIS', code: 'NHIS', payer_type: 'nhis', active: true }]));
      }
      if (target.pathname.endsWith('/billing/service-catalog')) {
        const secondPage = target.searchParams.get('cursor') === 'service-page-2';
        return json(page(secondPage
          ? [{ id: 'service-2', code: 'LAB-2', name: 'Second page service', active: true }]
          : [{ id: 'service-1', code: 'CONS-1', name: 'General consultation', active: true }], secondPage ? null : 'service-page-2'));
      }
      if (target.pathname.endsWith('/nhis/service-mappings')) {
        if (request.method === 'POST') {
          const data = JSON.parse(request.body);
          const mapping = { ...data, id: 'mapping-saved', nhis_code: 'SAVED-CODE', service_code: data.service_id === 'service-2' ? 'LAB-2' : 'CONS-1', service_name: 'Persisted service', version_number: 2, active: true };
          mappings = [mapping];
          return json({ data: mapping });
        }
        return json(page(mappings));
      }
      throw new Error('Unexpected NHIS test request');
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
      <QueryClientProvider client={queryClient}><MemoryRouter><NhisServiceMappingsPage /></MemoryRouter></QueryClientProvider>
    </AuthContext.Provider>);
  }

  async function openAndFill({ secondPage = false } = {}) {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New Mapping' }));
    const dialog = screen.getByRole('dialog');
    if (secondPage) await user.click(within(dialog).getByRole('button', { name: 'Go to next page' }));
    const trigger = within(dialog).getByRole('combobox', { name: 'Billable service' });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus();
    await user.keyboard('[ArrowDown]');
    await user.click(await screen.findByRole('option', { name: secondPage ? 'LAB-2 · Second page service' : 'CONS-1 · General consultation' }));
    await user.type(screen.getByLabelText('NHIS external code'), 'REQUESTED-CODE');
    return user;
  }

  it('blocks another mapping write when a generic database failure follows a persisted save', async () => {
    renderPage();
    const user = await openAndFill();
    const original = globalThis.fetch.getMockImplementation();
    globalThis.fetch.mockImplementation(async (url, request = {}) => {
      if (request.method === 'POST' && new URL(url).pathname.endsWith('/nhis/service-mappings')) {
        await original(url, request);
        return json({ error: { code: 'nhis_mapping_create_failed', message: 'NHIS service mapping could not be confirmed.' } }, 409);
      }
      return original(url, request);
    });
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    await screen.findByText('Save status unknown');
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
    expect(globalThis.fetch.mock.calls.filter(([url, request]) => request.method === 'POST' && new URL(url).pathname.endsWith('/nhis/service-mappings'))).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Close and review mappings' }));
    await screen.findByText(/SAVED-CODE/);
  });

  it('keeps an authoritative inactive-service rejection distinct from an unknown save', async () => {
    renderPage();
    const user = await openAndFill();
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'nhis_service_unavailable', message: 'An active service in this facility is required.' } }, 409));
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    await screen.findByText('An active service in this facility is required.');
    expect(screen.queryByText('Save status unknown')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeEnabled();
  });

  it('creates a mapping using a service beyond the first page and shows persisted values', async () => {
    renderPage();
    const user = await openAndFill({ secondPage: true });
    expect(screen.queryByRole('button', { name: 'Toggle' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    const saved = await screen.findByRole('status');
    expect(saved).toHaveTextContent('SAVED-CODE');
    expect(saved).toHaveTextContent('Version 2');
    const writes = globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1].body)).toEqual({ payer_id: 'payer-1', service_id: 'service-2', nhis_code: 'REQUESTED-CODE', effective_from: new Date().toISOString().slice(0, 10), effective_until: null });
    expect(globalThis.fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('cursor') === 'service-page-2')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await screen.findByText('Persisted service');
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview import/i })).not.toBeInTheDocument();
  });

  it('requires explicit NHIS management permission for the create action', async () => {
    renderPage(false);
    await screen.findByText(/creating mappings requires nhis claims management permission/i);
    expect(screen.queryByRole('button', { name: 'New Mapping' })).not.toBeInTheDocument();
  });

  it('preserves the saved confirmation after a failed refresh and requires a fresh read before another mapping', async () => {
    renderPage();
    const user = await openAndFill();
    const originalRequest = globalThis.fetch.getMockImplementation();
    let saved = false;
    let failRefresh = true;
    globalThis.fetch.mockImplementation(async (url, request = {}) => {
      if (request.method === 'POST') {
        saved = true;
        return originalRequest(url, request);
      }
      if (saved && failRefresh && new URL(url).pathname.endsWith('/nhis/service-mappings')) {
        return json({ error: { message: 'Mapping refresh unavailable.' } }, 503);
      }
      return originalRequest(url, request);
    });
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(await screen.findByRole('status')).toHaveTextContent('SAVED-CODE');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Mappings could not be refreshed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Mapping' })).toBeDisabled();
    failRefresh = false;
    await user.click(screen.getByRole('button', { name: 'Retry mappings refresh' }));
    await screen.findByText('Persisted service');
    expect(screen.getByRole('button', { name: 'New Mapping' })).toBeEnabled();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1);
  });

  it('validates effective-date ordering before any write', async () => {
    renderPage();
    const user = await openAndFill();
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2030-01-02' } });
    fireEvent.change(screen.getByLabelText('Effective until (optional)'), { target: { value: '2030-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(await screen.findByText('The end date must be after the start date.')).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(0);
  });

  it('blocks an identical retry after the write response is lost', async () => {
    renderPage();
    const user = await openAndFill();
    const read = globalThis.fetch.getMockImplementation();
    globalThis.fetch.mockImplementation((url, request = {}) => request.method === 'POST'
      ? Promise.reject(new TypeError('Connection lost')) : read(url, request));
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(await screen.findByText('Save status unknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1);
  });

  it('keeps a definite permission rejection visible without a saved claim', async () => {
    renderPage();
    const user = await openAndFill();
    globalThis.fetch.mockResolvedValueOnce(json({ error: { message: 'You do not have permission for this action.' } }, 403));
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(await screen.findByText('You do not have permission for this action.')).toBeInTheDocument();
    expect(screen.getByText('Mapping not saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeEnabled();
    expect(screen.queryByText('Mapping saved')).not.toBeInTheDocument();
  });

  it('prevents duplicate submission and dismissal while a save is pending', async () => {
    renderPage();
    const user = await openAndFill();
    const originalRequest = globalThis.fetch.getMockImplementation();
    let finishSave;
    globalThis.fetch.mockImplementation((url, request = {}) => {
      if (request.method === 'POST') {
        return new Promise((resolve) => { finishSave = () => resolve(originalRequest(url, request)); });
      }
      return originalRequest(url, request);
    });
    const form = screen.getByRole('button', { name: 'Save mapping' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByRole('button', { name: 'Saving…' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1);
    finishSave();
    expect(await screen.findByRole('status')).toHaveTextContent('SAVED-CODE');
  });
});
