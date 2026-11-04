import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SupplierCurrent } from '../components/SupplierCurrent';
import { SupplierHistory } from '../components/SupplierHistory';
import { SupplierDirectoryTable } from '../components/SupplierDirectoryTable';
import { RawValue } from '../components/SupplierValues';
import { supplier, historyId, stamp, listItem } from './fixtures';
afterEach(cleanup);
it('distinguishes not-recorded, empty and whitespace-only values without rewriting raw whitespace', () => {
  const { container } = render(<><RawValue value={null} /><RawValue value="" /><RawValue value={' \t\n'} /></>);
  expect(screen.getByText('Not recorded')).toBeInTheDocument(); expect(screen.getByText('Blank text')).toBeInTheDocument(); expect(screen.getByText('Whitespace-only text')).toBeInTheDocument(); expect(container.querySelectorAll('span')[2].textContent).toBe(' \t\n');
});
it('shows exact raw contact/address text and unknown/empty distinctions without manager controls for readers', () => {
  const value = { ...supplier, name: 'x'.repeat(121), contact_name: '', email: ' old malformed email ', phone: null, address: '  raw\n' + 'x'.repeat(8100) };
  render(<SupplierCurrent supplier={value} eligibility={{ lifecycle_blocked_by: 'item_reference' }} access={{ canManage: false, canWrite: false }} onAction={vi.fn()} />);
  expect(screen.getByText('Blank text')).toBeInTheDocument(); expect(screen.getByText('old malformed email')).toHaveTextContent('old malformed email');
  expect(screen.getByText('raw ' + 'x'.repeat(8100))).toHaveClass('whitespace-pre-wrap', '[overflow-wrap:anywhere]'); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('blocks referenced-supplier lifecycle while leaving correction available', () => {
  render(<SupplierCurrent supplier={supplier} eligibility={{ lifecycle_blocked_by: 'item_reference' }} access={{ canManage: true, canWrite: true }} onAction={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Correct supplier details' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Review supplier retirement' })).toBeDisabled();
});
it('keeps directory rows lean and presents a reachable exact-details control', () => {
  render(<SupplierDirectoryTable rows={[listItem(supplier)]} onView={vi.fn()} />);
  expect(screen.getByRole('button', { name: `View supplier details for ${supplier.name}` })).toBeEnabled(); expect(screen.queryByText('Contact name')).not.toBeInTheDocument(); expect(screen.queryByText('Address')).not.toBeInTheDocument();
});
it('renders history flags/revisions without private historical values or actor/reason copy', () => {
  render(<SupplierHistory rows={[{ id: historyId, action: 'correct', recorded_at: stamp, before_version: 1, after_version: 2, name_changed: false, contact_name_changed: true, phone_changed: false, email_changed: false, address_changed: true, active_changed: false }]} />);
  expect(screen.getByText('Contact name changed')).toBeInTheDocument(); expect(screen.getByText('Address changed')).toBeInTheDocument(); expect(screen.getByText('Recorded revision')).toBeInTheDocument(); expect(screen.queryByText(/recorded by/i)).not.toBeInTheDocument();
});
