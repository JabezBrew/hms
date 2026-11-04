import { createRef } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Row, Cell, Column } from 'react-aria-components';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from './Table';

afterEach(cleanup);
const rows = [{ id: 'first', name: 'First supplier' }, { id: 'second', name: 'Second supplier' }];
function Directory({ entries = rows, tableRef, onOpen = () => {} }) {
  return <Table ref={tableRef} aria-label="Example suppliers" selectionMode="none">
    <TableHeader><TableColumn id="name" isRowHeader>Supplier</TableColumn><TableColumn id="action">Action</TableColumn></TableHeader>
    <TableBody items={entries}>{row => <TableRow id={row.id} textValue={row.name}>
      <TableCell>{row.name}</TableCell><TableCell><button onClick={() => onOpen(row.id)}>Open {row.name}</button></TableCell>
    </TableRow>}</TableBody>
  </Table>;
}
it('forwards a React18 ref to the real named table and preserves direct collection exports', () => {
  const ref = createRef(); render(<Directory tableRef={ref} />);
  expect(ref.current).toBeInstanceOf(HTMLTableElement);
  expect(ref.current).toBe(screen.getByRole('grid', { name: 'Example suppliers' }));
  expect(TableRow).toBe(Row); expect(TableCell).toBe(Cell); expect(TableColumn).toBe(Column);
  expect(screen.getAllByRole('rowheader').map(cell => cell.textContent)).toEqual(rows.map(row => row.name));
});
it('replaces a server-supplied page without sorting it or retaining removed collection rows', () => {
  const { rerender } = render(<Directory />);
  rerender(<Directory entries={[{ id: 'second', name: 'Revised supplier' }, { id: 'third', name: 'Third supplier' }]} />);
  expect(screen.queryByText('First supplier')).not.toBeInTheDocument();
  expect(screen.getAllByRole('rowheader').map(cell => cell.textContent)).toEqual(['Revised supplier', 'Third supplier']);
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: /sort/i })).not.toBeInTheDocument();
});
it('keeps row keyboard navigation and the nested detail action reachable without selecting rows', async () => {
  const user = userEvent.setup(), open = vi.fn(); render(<Directory onOpen={open} />);
  await user.tab(); await user.keyboard('{ArrowDown}');
  const second = screen.getByRole('rowheader', { name: 'Second supplier' }).closest('tr');
  expect(second.contains(document.activeElement)).toBe(true);
  for (let attempt = 0; attempt < 4 && document.activeElement !== within(second).getByRole('button'); attempt++) await user.tab();
  expect(within(second).getByRole('button')).toHaveFocus();
  await user.keyboard('{Enter}'); expect(open).toHaveBeenCalledExactlyOnceWith('second');
  expect(screen.queryByRole('row', { selected: true })).not.toBeInTheDocument();
});
