import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import ItemDetailPage from '../ItemDetailPage';
import { catalogToday } from '../../api/catalogCorrections';

describe('inventory catalog correction workflow', () => {
  const originalFetch = globalThis.fetch;
  const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
  let item;
  let queryClient;
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  beforeEach(() => {
    item = { id: 'item-1', code: 'OLD-1', sku: 'OLD-1', name: 'Original item', unit: 'pack', unit_of_measure: 'pack', category_name: 'Supplies', total_stock: 5, is_active: true };
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
    globalThis.fetch = vi.fn(async (url, request = {}) => {
      if (request.method === 'POST') {
        const data = JSON.parse(request.body);
        item = { ...item, ...data, code: 'SAVED-1', sku: 'SAVED-1', name: 'Persisted item', unit_of_measure: data.unit };
        return json({ data: { ...data, code: 'SAVED-1', name: 'Persisted item', id: 'version-1', created_at: '2026-10-15T12:00:00Z' } });
      }
      return json({ data: item });
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
    return render(<AuthContext.Provider value={{ user: { adminAccess: { capabilities: canManage ? ['inventory.manage'] : [] } } }}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/inventory/items/item-1']}>
          <Routes><Route path="/inventory/items/:id" element={<ItemDetailPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>);
  }

  async function openAndFill() {
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Correct catalog details' }));
    await user.clear(screen.getByLabelText('Item code'));
    await user.type(screen.getByLabelText('Item code'), 'NEW-1');
    await user.clear(screen.getByLabelText('Item name'));
    await user.type(screen.getByLabelText('Item name'), 'Requested item');
    await user.type(screen.getByLabelText('Reason for correction'), 'Correct label');
    return user;
  }

  it('shows persisted server values and refreshes the actual item detail after save', async () => {
    renderPage();
    const user = await openAndFill();
    expect(screen.getByLabelText('Effective date (UTC)')).toHaveAttribute('max', catalogToday());
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    const saved = await screen.findByRole('status');
    expect(within(saved).getByText('SAVED-1')).toBeInTheDocument();
    expect(within(saved).getByText('Persisted item')).toBeInTheDocument();
    expect(within(saved).queryByText('Requested item')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save correction' })).not.toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Persisted item' })).toBeInTheDocument());
  });

  it('hides correction for read-only inventory users', async () => {
    renderPage(false);
    await screen.findByRole('heading', { name: 'Original item' });
    expect(screen.queryByRole('button', { name: 'Correct catalog details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it('preserves the saved version when current-item refresh fails and requires a fresh read before another correction', async () => {
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
      if (saved && failRefresh) return json({ error: { message: 'Item refresh unavailable.' } }, 503);
      return originalRequest(url, request);
    });
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByRole('status')).toHaveTextContent('SAVED-1');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('Current item could not be refreshed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Correct catalog details' })).toBeDisabled();
    failRefresh = false;
    await user.click(screen.getByRole('button', { name: 'Retry item refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Correct catalog details' })).toBeEnabled());
    expect(screen.getByRole('heading', { name: 'Persisted item' })).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1);
  });

  it('rejects a future effective date without posting', async () => {
    renderPage();
    const user = await openAndFill();
    fireEvent.change(screen.getByLabelText('Effective date (UTC)'), { target: { value: '9999-01-01' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save correction' }).closest('form'));
    expect(await screen.findByText(/choose today or an earlier date/i)).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('does not offer a second write when the save response is lost', async () => {
    renderPage();
    const user = await openAndFill();
    globalThis.fetch.mockImplementation(async (_url, request = {}) => {
      if (request.method === 'POST') throw new TypeError('Connection lost');
      return json({ data: item });
    });
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByText('Save status unknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    expect(screen.getByText(/close this dialog and refresh the item/i)).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1);
  });

  it('keeps a definite permission rejection visible without claiming a saved correction', async () => {
    renderPage();
    const user = await openAndFill();
    globalThis.fetch.mockResolvedValueOnce(json({ error: { message: 'You do not have permission for this action.' } }, 403));
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByText('You do not have permission for this action.')).toBeInTheDocument();
    expect(screen.getByText('Correction not saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeEnabled();
    expect(screen.queryByText('Catalog correction saved')).not.toBeInTheDocument();
  });

  it('prevents concurrent submission and dismissal while the write is pending', async () => {
    renderPage();
    const user = await openAndFill();
    let finishSave;
    globalThis.fetch.mockImplementation(async (_url, request = {}) => {
      if (request.method === 'POST') {
        return new Promise((resolve) => { finishSave = () => resolve(json({ data: { ...JSON.parse(request.body), id: 'version-1' } })); });
      }
      return json({ data: item });
    });
    const form = screen.getByRole('button', { name: 'Save correction' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByRole('button', { name: 'Saving…' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(globalThis.fetch.mock.calls.filter(([, request]) => request.method === 'POST')).toHaveLength(1);
    finishSave();
    await screen.findByText('Catalog correction saved');
  });
});
