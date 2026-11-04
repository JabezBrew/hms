import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/shared/components/boardui/Table';
import { displayText } from '../model';

export function SupplierDirectoryTable({ rows, onView }) {
  return <Table aria-label="Suppliers" selectionMode="none">
    <TableHeader>
      <TableColumn id="supplier" isRowHeader>Supplier</TableColumn>
      <TableColumn id="status">Status</TableColumn>
      <TableColumn id="actions"><span className="sr-only">Actions</span></TableColumn>
    </TableHeader>
    <TableBody items={rows}>{supplier => <TableRow id={supplier.id} textValue={displayText(supplier.name)}>
      <TableCell className="min-w-40 max-w-80 whitespace-normal [overflow-wrap:anywhere]">
        <p className="font-medium">{displayText(supplier.name)}</p>
        <p className="mt-1 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{supplier.code} · Revision {supplier.version}</p>
      </TableCell>
      <TableCell><Badge variant="secondary">{supplier.is_active ? 'Active' : 'Retired'}</Badge></TableCell>
      <TableCell><Button type="button" variant="outline" size="sm" onClick={() => onView(supplier.id)} aria-label={`View supplier details for ${displayText(supplier.name)}`}>View details</Button></TableCell>
    </TableRow>}</TableBody>
  </Table>;
}
