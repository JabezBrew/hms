import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LabCatalogPage from '../LabCatalogPage';

// Exactly the current ordinary Rust10-field test and8-field panel projection.
// The page seam is exercised with service-shaped rows, not invented price/TAT/LOINC fields.
const fixture = vi.hoisted(() => ({
  test: { id: '27272727-2727-4272-8272-000000000001', code: 'CBC_INTERNAL', name: 'Synthetic catalog test', category: 'hematology', specimen_type: 'blood', result_unit: null, is_active: true, is_system_default: true, is_facility_modified: false, created_at: '2026-11-03T00:00:00Z' },
  panel: { id: '27272727-2727-4272-8272-000000000002', code: 'PANEL_INTERNAL', name: 'Synthetic catalog panel', is_active: true, is_system_default: true, is_facility_modified: false, test_count: 2, created_at: '2026-11-03T00:00:00Z' },
}));
vi.mock('@/features/laboratory/hooks', () => {
  const row = kind => window.__HMS_RUNTIME_CONFIG__?.apiMode === 'rust-v2' ? fixture[kind]
    : kind === 'test' ? { ...fixture.test, loinc_code: '1234-5', description: 'Legacy test description', price: '45.00', tat_hours: 4 }
      : { ...fixture.panel, description: 'Legacy panel description', price: '80.00' };
  const page = kind => ({ data: { results: [row(kind)], count: 1 }, isLoading: false, isFetching: false, refetch: vi.fn() });
  return { useLabTests: () => page('test'), useLabPanels: () => page('panel'),
    useLabTest: id => ({ data: id ? row('test') : null, isLoading: false }),
    useLabPanel: id => ({ data: id ? row('panel') : null, isLoading: false }),
    useDeleteLabTest: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteLabPanel: () => ({ mutateAsync: vi.fn(), isPending: false }) };
});
// Render the actual column configuration without exercising viewport virtualization.
// This is a page/contract regression seam, never a rendered-browser/a11y claim.
vi.mock('@/components/ui/VirtualizedTable', () => ({ default: ({ rows = [], columns = [] }) => <table>
  <thead><tr>{columns.map(column => <th key={column.key}>{column.header}</th>)}</tr></thead>
  <tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>)}</tbody>
</table> }));
vi.mock('@/components/laboratory/LabTestCustomizeSlideOver', () => ({ LabTestCustomizeSlideOver: () => null }));
vi.mock('@/components/laboratory/AddLabTestSlideOver', () => ({ AddLabTestSlideOver: () => null }));
vi.mock('@/hooks/useSlideOver', () => ({ useSlideOver: () => [false, vi.fn(), vi.fn()] }));
const previousRuntime = window.__HMS_RUNTIME_CONFIG__;
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); window.__HMS_RUNTIME_CONFIG__ = previousRuntime; });
function mount(mode, path = '/laboratory/catalog') {
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: mode };
  return render(<MemoryRouter initialEntries={[path]}><LabCatalogPage /></MemoryRouter>);
}
it('uses the actual Rust internal test code without inventing LOINC, price, TAT or description facts', () => {
  mount('rust-v2');
  expect(screen.getByText('CBC_INTERNAL')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Code', exact: true })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Price', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'TAT', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText('Not set', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText('No description', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText(/LOINC/i)).not.toBeInTheDocument();
});
it('keeps exact Rust panel identity/count while omitting unsupported panel price/description', () => {
  mount('rust-v2', '/laboratory/catalog?tab=panels');
  expect(screen.getByText('PANEL_INTERNAL')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Tests', exact: true })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Price', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText('Not set', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText('No description', { exact: true })).not.toBeInTheDocument();
});
it.each([['tests', 'test'], ['panels', 'panel']])('does not imply an unconfigured price in the Rust selected %s deep link', (tab, kind) => {
  const { container } = mount('rust-v2', `/laboratory/catalog?tab=${tab}&${kind}=${fixture[kind].id}`);
  const selected = within(container.querySelector('[data-omni-target="true"]'));
  expect(selected.getByText(fixture[kind].code, { exact: true })).toBeInTheDocument();
  expect(selected.queryByText('Not set', { exact: true })).not.toBeInTheDocument();
  expect(selected.queryByText(/\$/)).not.toBeInTheDocument();
});
it('preserves legacy LOINC priority, description, USD price and turnaround display', () => {
  mount('django');
  expect(screen.getByText('1234-5')).toBeInTheDocument();
  expect(screen.queryByText('CBC_INTERNAL', { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText('Legacy test description')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Price', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'TAT', exact: true })).toBeInTheDocument();
  expect(screen.getByText('$45.00', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('4h', { exact: true })).toBeInTheDocument();
});
it('preserves legacy panel price/description in both directory and selected panel', () => {
  const { container } = mount('django', `/laboratory/catalog?tab=panels&panel=${fixture.panel.id}`);
  expect(screen.getByRole('columnheader', { name: 'Price', exact: true })).toBeInTheDocument();
  expect(screen.getByText('Legacy panel description')).toBeInTheDocument();
  expect(screen.getAllByText('$80.00', { exact: true })).toHaveLength(2);
  expect(within(container.querySelector('[data-omni-target="true"]')).getByText('$80.00', { exact: true })).toBeInTheDocument();
});
