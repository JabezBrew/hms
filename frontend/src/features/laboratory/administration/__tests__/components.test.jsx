import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CatalogDirectoryTable } from '../components/CatalogDirectory';
import { listItem, subject, testId, otherId } from './fixtures';
afterEach(cleanup);
it('keeps server order and opaque row actions through BoardUI collection replacement', () => {
  const view = vi.fn(), first = listItem(subject()), second = listItem(subject('test', { id: otherId, name: 'Synthetic second definition' }));
  const tree = render(<CatalogDirectoryTable kind="test" rows={[first, second]} onView={view} />);
  expect(screen.getByRole('grid', { name: 'Laboratory test definitions' })).toBeInTheDocument(); expect(screen.getAllByRole('rowheader').map(row => row.textContent)).toEqual([expect.stringContaining(first.name), expect.stringContaining(second.name)]);
  tree.rerender(<CatalogDirectoryTable kind="test" rows={[{ ...second, name: 'Synthetic replacement label' }]} onView={view} />); expect(screen.queryByText(first.name)).not.toBeInTheDocument(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(screen.queryByRole('columnheader', { name: /sort/i })).not.toBeInTheDocument();
});
it('moves by keyboard to a named definition action without selecting a row or submitting availability', async () => {
  const event = userEvent.setup(), view = vi.fn(), first = listItem(subject()), second = { ...first, id: otherId, name: 'Synthetic second definition' };
  render(<CatalogDirectoryTable kind="test" rows={[first, second]} onView={view} />); await event.tab(); await event.keyboard('{ArrowDown}');
  const row = screen.getByRole('rowheader', { name: new RegExp(second.name) }).closest('tr'), button = within(row).getByRole('button'); expect(row.contains(document.activeElement)).toBe(true);
  for (let step = 0; step < 4 && document.activeElement !== button; step++) await event.tab(); expect(button).toHaveFocus(); await event.keyboard('{Enter}'); expect(view).toHaveBeenCalledExactlyOnceWith(otherId); expect(view).not.toHaveBeenCalledWith(testId); expect(screen.queryByRole('row', { selected: true })).not.toBeInTheDocument();
});
