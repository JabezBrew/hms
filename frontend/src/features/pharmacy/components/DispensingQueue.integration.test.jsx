import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { PharmacyQueue } from '@/components/pharmacy/PharmacyQueue';
vi.mock('@/components/patients/PatientContextPanel', () => ({ default: () => null }));
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const row = { id: 'fulfillment-opaque', patient_id: 'patient-opaque', patient_display_name: 'Synthetic Patient', patient_code: 'SYNTHETIC', medication_name: 'Prescribed product', inventory_item_id: 'stock-opaque', inventory_item_name: 'Actual linked tablets', inventory_item_code: 'TAB-01', inventory_item_unit: 'tablet', dispensing_location_id: 'location-1', frequency: 'prn', dose: 'One dose', route: 'oral', status: 'pending', requested_dose_count: 1, dispensed_dose_count: 0, coverage_start: '2026-10-16T00:00:00Z', coverage_end: '2026-10-17T00:00:00Z', prn_policy: { stock_units_per_dose: 2, stock_unit: 'tablet' } };
const actor = { id: 'actor-1', facilityCode: 'HMS', accessContext: { facility_id: 'facility-1', active_profile: 'pharmacy-1' }, adminAccess: { capabilities: ['pharmacy.dispense'] } };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const page = (data, cursor = null) => ({ data, page: { limit: 25, has_next: Boolean(cursor), next_cursor: cursor } });
let client; let locationsFail; let saved; let unknown;
beforeEach(() => {
  row.inventory_item_unit = 'tablet';
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } }); locationsFail = false; saved = false; unknown = false;
  globalThis.fetch = vi.fn(async (url) => {
    const parsed = new URL(url); const path = parsed.pathname;
    if (path.endsWith('/dispensing-locations')) return locationsFail ? json({ error: { code: 'unavailable', message: 'Locations unavailable' } }, 503) : json(page(parsed.searchParams.get('cursor') ? [{ id: 'location-2', name: 'Ward pharmacy', code: 'WARD' }] : [{ id: 'location-1', name: 'Main pharmacy', code: 'MAIN' }], parsed.searchParams.get('cursor') ? null : 'next-location'));
    if (path.endsWith('/fulfillment-opaque/dispense')) { saved = true; if (unknown) throw new TypeError('Lost supply response'); return json({ data: { fulfillment: { ...row, status: 'dispensed', dispensed_dose_count: 1 }, dispensed_dose_count: 1, remaining_dose_count: 0 } }); }
    if (path.endsWith('/dispensing-queue')) return json(page(saved ? [] : [row]));
    throw new Error('Unexpected pharmacy picker test request');
  });
});
afterEach(() => { client.clear(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
function tree(user = actor) { return <AuthContext.Provider value={{ user }}><QueryClientProvider client={client}><PharmacyQueue /></QueryClientProvider></AuthContext.Provider>; }
function issues() { return globalThis.fetch.mock.calls.filter(([url, options]) => options.method === 'POST' && new URL(url).pathname.endsWith('/dispense')); }
async function open() { fireEvent.click(await screen.findByRole('button', { name: /^Dispense$/ })); return screen.findByRole('button', { name: /Main pharmacy/ }); }
describe('real queue dispensing with named locations', () => {
  it('requires explicit bounded location selection and posts linked identity with actual PRN dose basis', async () => {
    render(tree()); const choice = await open(); expect(screen.getByRole('dialog')).toHaveTextContent('Synthetic Patient · SYNTHETIC'); expect(screen.getByRole('button', { name: 'Confirm Dispense' })).toBeDisabled(); expect(screen.getByText('Actual linked tablets')).toBeInTheDocument(); expect(screen.queryByText('stock-opaque')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Location ID')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next locations' })); fireEvent.click(await screen.findByRole('button', { name: /Ward pharmacy/ })); expect(choice).not.toBeInTheDocument(); expect(screen.getByText(/This supply uses 2 tablet/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Confirm Dispense' })); await screen.findByText('Supply confirmed');
    expect(issues()).toHaveLength(1); expect(JSON.parse(issues()[0][1].body)).toEqual({ item_id: 'stock-opaque', location_id: 'location-2', quantity: 1 });
  });
  it('fails closed on location load error and recovers through explicit refresh', async () => {
    locationsFail = true; render(tree()); fireEvent.click(await screen.findByRole('button', { name: /^Dispense$/ })); await screen.findByText(/Locations could not be loaded/); expect(screen.getByRole('button', { name: 'Confirm Dispense' })).toBeDisabled(); locationsFail = false; fireEvent.click(screen.getByRole('button', { name: 'Retry locations' })); await screen.findByRole('button', { name: /Main pharmacy/ }); expect(issues()).toHaveLength(0);
  });
  it('searches names/codes without putting search text in query keys', async () => {
    render(tree()); await open(); fireEvent.change(screen.getByLabelText('Search dispensing locations'), { target: { value: 'WARD' } }); await waitFor(() => expect(globalThis.fetch.mock.calls.some(([url]) => new URL(url).searchParams.get('search') === 'WARD')).toBe(true)); expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey))).not.toContain('WARD'); expect(issues()).toHaveLength(0);
  });
  it('keeps uncertain stock issue locked without automatic retry', async () => {
    unknown = true; render(tree()); fireEvent.click(await open()); fireEvent.click(screen.getByRole('button', { name: 'Confirm Dispense' })); await screen.findByText('Supply status unknown'); expect(screen.getByRole('button', { name: 'Confirm Dispense' })).toBeDisabled(); expect(issues()).toHaveLength(1);
  });
  it('blocks duplicate clicks and pending dismissal until the issue is confirmed', async () => {
    render(tree()); fireEvent.click(await open()); const normal = globalThis.fetch.getMockImplementation(); let finish;
    globalThis.fetch.mockImplementation((url, options) => new URL(url).pathname.endsWith('/dispense') ? new Promise((resolve) => { finish = () => resolve(normal(url, options)); }) : normal(url, options));
    const confirm = screen.getByRole('button', { name: 'Confirm Dispense' }); fireEvent.click(confirm); fireEvent.click(confirm); await screen.findByRole('button', { name: 'Dispensing…' }); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled(); expect(issues()).toHaveLength(1); finish(); await screen.findByText('Supply confirmed');
  });
  it('blocks supply when the current catalog unit differs from the prescribed PRN basis', async () => {
    row.inventory_item_unit = 'pack'; render(tree()); fireEvent.click(await open()); expect(screen.getByText(/Prescriber review is required before supply/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm Dispense' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm Dispense' })); expect(issues()).toHaveLength(0);
  });
  it.each([{ active_profile: 'pharmacy-2' }, { facility_id: 'facility-2' }])('clears the selected location when authorization scope changes to %j', async (changedScope) => {
    const view = render(tree()); fireEvent.click(await open()); expect(screen.getByRole('button', { name: 'Confirm Dispense' })).not.toBeDisabled(); view.rerender(tree({ ...actor, accessContext: { ...actor.accessContext, ...changedScope } })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); await open(); expect(screen.getByRole('button', { name: 'Confirm Dispense' })).toBeDisabled();
  });
});
