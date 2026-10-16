import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import StandingTemplatesPage from '../StandingTemplatesPage';
import InternalRequisitionsPage from '../../pages/InternalRequisitionsPage';

vi.mock('@/components/ui/VirtualizedTable', () => ({ default: ({ rows, columns }) => <div>{rows.map((row) => <div key={row.id}>{columns.map((column) => <div key={column.key}>{column.render ? column.render(row) : row[column.key]}</div>)}</div>)}</div> }));
const originalFetch = globalThis.fetch;
const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const item = { id: 'item-1', code: 'BAND', name: 'Bandages', unit: 'pack' };
const locations = [{ id: 'ward', name: 'Ward A', code: 'WA' }, { id: 'store', name: 'Main store', code: 'MS' }];
const templateFixture = { id: 'template-1', name: 'Ward supplies', requesting_location_id: 'ward', requesting_location_name: 'Ward A', fulfilling_location_id: 'store', fulfilling_location_name: 'Main store', frequency: 'weekly', next_run_on: '2026-01-01', monthly_day: null, status: 'active', version: 4, line_count: 1, notes: null, items: [{ id: 'line-1', item_id: item.id, item_name: item.name, item_code: item.code, unit: 'pack', current_unit: 'pack', requires_unit_review: false, quantity: 2 }] };
const requestFixture = { id: 'request-1', source_template_id: 'template-1', template_version: 4, scheduled_for: '2026-01-01', status: 'requested', requesting_location_id: 'ward', requesting_location_name: 'Ward A', fulfilling_location_id: 'store', fulfilling_location_name: 'Main store', created_at: '2026-10-15T12:00:00Z', items: [{ id: 'request-line-1', item_id: item.id, item_name: item.name, item_code: item.code, unit: 'pack', quantity_requested: 2, quantity_issued: 0 }] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const page = (data, next = null) => ({ data, page: { limit: 25, has_next: Boolean(next), next_cursor: next } });
let client;
let template;
let request;
let unavailable;
let lostIssue;
let historical;
beforeEach(() => {
  template = structuredClone(templateFixture); request = structuredClone(requestFixture); unavailable = false; lostIssue = false; historical = false;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } });
  globalThis.fetch = vi.fn(async (url, options) => {
    const parsed = new URL(url); const path = parsed.pathname; const body = options.body && JSON.parse(options.body);
    if (path.endsWith('/standing-order-templates') && options.method === 'POST') {
      template = { ...template, ...body, items: body.items.map((line) => ({ ...templateFixture.items[0], quantity: line.quantity })) }; return json({ data: template });
    }
    if (path.endsWith('/standing-order-templates')) return unavailable ? json({ error: { code: 'unavailable', message: 'Unavailable' } }, 503) : json(page([template]));
    if (path.endsWith('/standing-order-templates/template-1')) return json({ data: template });
    if (path.endsWith('/template-1/runs')) { template = { ...template, next_run_on: '2099-01-01', version: 5, last_requisition_id: request.id }; return json({ data: request }); }
    if (path.endsWith('/request-1/review/approve')) { request = { ...request, status: 'approved', approved_at: '2026-10-15T12:01:00Z' }; return json({ data: request }); }
    if (path.endsWith('/request-1/review/cancel')) { request = { ...request, status: 'cancelled', cancelled_at: '2026-10-15T12:01:00Z' }; return json({ data: request }); }
    if (path.endsWith('/request-1/issue')) { request = { ...request, status: 'fulfilled', fulfilled_at: '2026-10-15T12:02:00Z', items: request.items.map((line) => ({ ...line, quantity_issued: 2 })) }; if (lostIssue) throw new TypeError('Network lost after commit'); return json({ data: request }); }
    if (path.endsWith('/request-1/review')) return json({ data: request });
    if (path.endsWith('/inventory/items')) return json(page([item]));
    if (path.endsWith('/inventory/storage-locations')) return json(page(locations));
    if (path.endsWith('/inventory/requisitions')) return json(page([{ ...request, line_count: historical ? 0 : 1, source_type: historical ? null : 'standing_order_template', source_id: historical ? null : template.id }]));
    throw new Error('Unexpected standing-order test request');
  });
});
afterEach(() => { client.clear(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
function renderPage(Component = StandingTemplatesPage, canManage = true) {
  return render(<AuthContext.Provider value={{ user: { adminAccess: { capabilities: canManage ? ['inventory.manage'] : [] } } }}><QueryClientProvider client={client}><MemoryRouter><Component /></MemoryRouter></QueryClientProvider></AuthContext.Provider>);
}
function writes(suffix) { return globalThis.fetch.mock.calls.filter(([url, options]) => options.method === 'POST' && new URL(url).pathname.endsWith(suffix)); }
async function choose(label, name) { const region = screen.getByRole('region', { name: label }); fireEvent.click(within(region).getByRole('button', { name: 'Choose' })); fireEvent.click(await within(region).findByRole('button', { name: new RegExp(name) })); }
describe('standing orders through the active generated-client pages', () => {
  it('persists explicit template items and preserves its receipt across list-refresh failure', async () => {
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: 'New template' })); fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Restock supplies' } });
    await choose('Requesting location', 'Ward A'); await choose('Fulfilling location', 'Main store'); fireEvent.click(screen.getByRole('button', { name: 'Add item' })); await choose('Item 1', 'Bandages'); fireEvent.change(screen.getByLabelText('Quantity (pack)'), { target: { value: '3' } });
    unavailable = true; fireEvent.click(screen.getByRole('button', { name: 'Save template' })); await screen.findByText('Saved configuration'); await screen.findByText('Standing templates unavailable');
    expect(screen.getByRole('dialog')).toHaveTextContent('Restock supplies'); expect(screen.getByText('Saving this configuration does not reserve or move stock.')).toBeInTheDocument(); expect(writes('/standing-order-templates')).toHaveLength(1);
    expect(JSON.parse(writes('/standing-order-templates')[0][1].body).items).toEqual([{ item_id: item.id, quantity: 3, expected_unit: 'pack' }]);
  });
  it('generates one occurrence, approves, then issues from a fresh persisted review', async () => {
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: 'Review Ward supplies' })); fireEvent.click(await screen.findByRole('button', { name: 'Generate due request' })); expect(writes('/runs')).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByText('Request saved'); fireEvent.click(screen.getByRole('button', { name: 'Review and approve request' })); fireEvent.click(await screen.findByRole('button', { name: 'Approve request' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));
    await screen.findByText('Approval confirmed'); fireEvent.click(await screen.findByRole('button', { name: 'Issue requested stock' })); expect(writes('/issue')).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Confirm stock issue' })); await screen.findByText('Stock issue confirmed');
    expect(writes('/runs')).toHaveLength(1); expect(writes('/review/approve')).toHaveLength(1); expect(writes('/issue')).toHaveLength(1); expect(screen.getByRole('dialog')).toHaveTextContent('fulfilled'); expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
  });
  it('opens a governed request from internal requisitions and resolves a lost issue response by review', async () => {
    request.status = 'approved'; lostIssue = true; renderPage(InternalRequisitionsPage); fireEvent.click(await screen.findByRole('button', { name: 'Review' })); fireEvent.click(await screen.findByRole('button', { name: 'Issue requested stock' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm stock issue' }));
    await screen.findByText('Change status unknown'); expect(writes('/issue')).toHaveLength(1); expect(screen.getByRole('button', { name: 'Confirm stock issue' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Refresh request status' }));
    await waitFor(() => expect(screen.queryByText('Change status unknown')).not.toBeInTheDocument()); expect(screen.getByRole('dialog')).toHaveTextContent('fulfilled'); expect(writes('/issue')).toHaveLength(1);
  });
  it('keeps historical header-only requests read-only', async () => {
    historical = true; renderPage(InternalRequisitionsPage); fireEvent.click(await screen.findByRole('button', { name: 'Review' })); await screen.findByText(/older request has no item list/);
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Issue requested stock' })).not.toBeInTheDocument(); expect(globalThis.fetch.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/review'))).toBe(false);
  });
  it('does not expose writes to a read-only actor and keeps actual Rust request status', async () => {
    renderPage(InternalRequisitionsPage, false); await waitFor(() => expect(screen.getAllByText('Requested')).toHaveLength(2)); fireEvent.click(screen.getByRole('button', { name: 'Review' })); await screen.findByText('Bandages');
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument(); expect(writes('/review/approve')).toHaveLength(0);
  });
});
