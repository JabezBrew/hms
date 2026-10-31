import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectoryFilters } from '../components/DirectoryControls';
import { CatalogDirectoryTable } from '../components/CatalogDirectoryTable';
import { CatalogHistory } from '../components/CatalogHistory';
import { catalogKeys } from '../keys';
import { canManageCatalog, canReadCatalog } from '../access';
import { actorId, item, revisionId, stamp } from './fixtures';
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('searches only explicitly, with a real accessible label and trimmed bounded value', () => {
  const onChange = vi.fn(); render(<DirectoryFilters state={{ status: '', search: '' }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Find an item by name or code'), { target: { value: '  Synthetic search  ' } }); expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Search catalog' })); expect(onChange).toHaveBeenCalledWith({ status: '', search: 'Synthetic search' });
  expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
});
it('refuses oversized UTF-8 search without submitting or silently truncating it', () => {
  const onChange = vi.fn(); render(<DirectoryFilters state={{ status: '' }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Find an item by name or code'), { target: { value: '😀'.repeat(41) } }); fireEvent.click(screen.getByRole('button', { name: 'Search catalog' }));
  expect(screen.getByRole('alert')).toHaveTextContent('160 UTF-8 bytes'); expect(onChange).not.toHaveBeenCalled();
});
it('preserves the applied search on an explicit status selection, and honors disabled controls', async () => {
  const onChange = vi.fn(), user = userEvent.setup(); const view = render(<DirectoryFilters state={{ status: '', search: 'Applied search' }} onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Status' }), { key: 'ArrowDown' }); await user.click(await screen.findByRole('option', { name: 'Retired' }));
  expect(onChange).toHaveBeenCalledWith({ status: 'retired', search: 'Applied search' });
  view.rerender(<DirectoryFilters state={{ status: '', search: '' }} onChange={onChange} disabled />);
  expect(screen.getByLabelText('Find an item by name or code')).toBeDisabled(); expect(screen.getByRole('combobox', { name: 'Status' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Search catalog' })).toBeDisabled();
});
it('gives readers exact item navigation without an editing wall or inferred stock/pricing', async () => {
  const onView = vi.fn(), onAction = vi.fn(), user = userEvent.setup(); render(<CatalogDirectoryTable rows={[item]} canManage={false} onView={onView} onAction={onAction} />);
  await user.click(screen.getByRole('button', { name: `View catalog details for ${item.name}` })); expect(onView).toHaveBeenCalledWith(item.id); expect(onAction).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Catalog actions/ })).not.toBeInTheDocument(); expect(screen.queryByText(/stock|price/i)).not.toBeInTheDocument();
});
it('keeps controlled/unsupported lifecycle absent while permitting metadata review through the exact item', async () => {
  const onAction = vi.fn(), user = userEvent.setup(); const controlled = { ...item, controlled: true, effective_controlled: true };
  render(<CatalogDirectoryTable rows={[controlled]} canManage onView={vi.fn()} onAction={onAction} />);
  await user.click(screen.getByRole('button', { name: `Catalog actions for ${item.name}` })); expect(screen.queryByRole('menuitem', { name: /retire|reactivat/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: 'Correct catalog details' })); expect(onAction).toHaveBeenCalledWith('correct', controlled);
});
const legacy = { source: 'legacy_dated_version', id: revisionId, effective_from: '2035-01-01', effective_to: null, code: '', name: item.name, unit: item.unit, recorded_at: stamp, reason_present: true };
const governed = { source: 'governed_correction', id: revisionId, reviewed_effective_from: '2020-01-01', recorded_at: stamp, before: { code: item.code, name: item.name, unit: item.unit, version: 1 }, after: { code: item.code, name: item.name, unit: item.unit, version: 1 }, projection_changed: false, reason_present: true };
it('renders both sameUUID/time history sources in server order without offering restore or displaying reason text', () => {
  render(<CatalogHistory rows={[governed, { ...legacy, reason: 'Synthetic private reason not in general DTO' }]} />);
  const rows = within(screen.getByRole('list', { name: 'Catalog recording history' })).getAllByRole('listitem'); expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Governed correction'); expect(rows[1]).toHaveTextContent('Legacy dated record — no automatic activation');
  expect(screen.getByText('Review recorded; details unchanged')).toBeInTheDocument(); expect(screen.queryByText('Synthetic private reason not in general DTO')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /restore|apply|activate/i })).not.toBeInTheDocument();
});
it('does not turn a legacy reviewed future date into activation after that date passes', () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z')); const view = render(<CatalogHistory rows={[legacy]} />);
  expect(screen.getByText('Legacy dated record — no automatic activation')).toBeInTheDocument();
  vi.setSystemTime(new Date('2040-01-01T00:00:00Z')); view.rerender(<CatalogHistory rows={[legacy]} />); expect(screen.getByText('Legacy dated record — no automatic activation')).toBeInTheDocument();
});
it('withholds cached history on a current error instead of presenting it as current evidence', () => {
  render(<CatalogHistory rows={[legacy]} error={new Error('Synthetic current denial')} onRetry={vi.fn()} />);
  expect(screen.getByText('Catalog history unavailable')).toBeInTheDocument(); expect(screen.queryByText(item.name)).not.toBeInTheDocument();
});
it('uses independent current inventory/demographics/feature/visibility capability facts, with no admin fallback', () => {
  const user = { id: actorId, role: 'staff', adminAccess: { capabilities: ['inventory.view', 'patient.demographics.view', 'system.deployment_capabilities.view'] }, accessContext: { features: ['inventory'], patient_visibility: ['demographics'] } };
  expect(canReadCatalog(user)).toBe(true); expect(canManageCatalog(user)).toBe(false);
  expect(canManageCatalog({ ...user, adminAccess: { capabilities: [...user.adminAccess.capabilities, 'inventory.manage'] } })).toBe(true);
  expect(canReadCatalog({ ...user, role: 'admin', adminAccess: { capabilities: [] } })).toBe(false);
  expect(canReadCatalog({ ...user, accessContext: { ...user.accessContext, patient_visibility: [] } })).toBe(false);
});
it('keeps free text, codes/units/reasons and raw item/cursor values out of purpose-scoped query keys', () => {
  const secret = 'Synthetic private search', cursor = 'opaque-synthetic-cursor'; const params = { limit: 25, search: secret, cursor, code: 'PRIVATE-CODE', reason: 'PRIVATE-REASON', unit: 'PRIVATE-UNIT' };
  const keys = [catalogKeys.page('opaque-current-scope', params), catalogKeys.detail('opaque-current-scope', item.id), catalogKeys.history('opaque-current-scope', item.id, params), catalogKeys.categories('opaque-current-scope', params)];
  const text = JSON.stringify(keys); for (const value of [secret, cursor, item.id, params.code, params.reason, params.unit]) expect(text).not.toContain(value);
  expect(catalogKeys.page('new-scope', params)).not.toEqual(keys[0]);
});
it.each(['__proto__', 'constructor', 'toString'])('renders an unknown prototype-name classification %s as unsupported data', item_type => {
  render(<CatalogDirectoryTable rows={[{ ...item, item_type }]} canManage={false} onView={vi.fn()} onAction={vi.fn()} />);
  expect(screen.getByText('Unsupported classification')).toBeInTheDocument(); expect(screen.getByText(`Stored classification: ${item_type}`)).toBeInTheDocument();
});
it('starts the search input with the actual applied query', () => {
  render(<DirectoryFilters state={{ status: '', search: 'Applied query' }} onChange={vi.fn()} />); expect(screen.getByLabelText('Find an item by name or code')).toHaveValue('Applied query');
});
it('preserves an unsent draft on unrelated status rerender', () => {
  const view = render(<DirectoryFilters state={{ status: '', search: 'Applied query' }} onChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('Find an item by name or code'), { target: { value: 'Unsent draft' } });
  view.rerender(<DirectoryFilters state={{ status: 'retired', search: 'Applied query' }} onChange={vi.fn()} />); expect(screen.getByLabelText('Find an item by name or code')).toHaveValue('Unsent draft');
});
it('reflects an external applied-query navigation/back without reviving an obsolete draft or remounting the input', () => {
  const view = render(<DirectoryFilters state={{ status: '', search: 'Applied A' }} onChange={vi.fn()} />), input = screen.getByLabelText('Find an item by name or code');
  fireEvent.change(input, { target: { value: 'Unsent draft' } });
  view.rerender(<DirectoryFilters state={{ status: '', search: 'Applied B' }} onChange={vi.fn()} />); expect(input).toHaveValue('Applied B');
  view.rerender(<DirectoryFilters state={{ status: '', search: 'Applied A' }} onChange={vi.fn()} />); expect(input).toHaveValue('Applied A'); expect(screen.getByLabelText('Find an item by name or code')).toBe(input);
});
it('supports an explicit draft reset while retaining the same applied query', () => {
  const view = render(<DirectoryFilters state={{ status: '', search: 'Applied A' }} resetKey={1} onChange={vi.fn()} />), input = screen.getByLabelText('Find an item by name or code');
  fireEvent.change(input, { target: { value: 'Unsent draft' } });
  view.rerender(<DirectoryFilters state={{ status: '', search: 'Applied A' }} resetKey={2} onChange={vi.fn()} />); expect(input).toHaveValue('Applied A');
});
