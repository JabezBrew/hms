import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { displayText, ordinaryItem } from '../model';
import { categoryName, classification, itemCode, itemName } from '../presentation';
export function CatalogDirectoryTable({ rows, canManage, busy, onView, onAction }) {
  return <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Category and classification</TableHead><TableHead>Unit</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
    <TableBody>{rows.map(item => <TableRow key={item.id}>
      <TableCell className="min-w-48 max-w-80 whitespace-normal break-words"><p className="font-medium">{itemName(item)}</p><p className="mt-1 break-words font-mono text-xs text-muted-foreground">{itemCode(item)} · Revision {item.version}</p></TableCell>
      <TableCell className="min-w-40 max-w-72 whitespace-normal break-words"><p>{categoryName(item)}</p><p className="mt-1 text-xs text-muted-foreground">{classification(item)}{item.effective_controlled ? ' · Controlled' : ''}</p>{!['medication', 'supply', 'controlled_substance'].includes(item.item_type) && <p className="mt-1 text-xs text-muted-foreground">Stored classification: {displayText(item.item_type)}</p>}</TableCell>
      <TableCell className="max-w-48 whitespace-normal break-words font-mono">{displayText(item.unit)}</TableCell><TableCell><Badge variant="secondary">{item.is_active ? 'Active' : 'Retired'}</Badge></TableCell>
      <TableCell><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => onView(item.id)} aria-label={`View catalog details for ${itemName(item)}`}>View details</Button>{canManage && <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`Catalog actions for ${itemName(item)}`}>Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onSelect={() => onAction('correct', item)}>Correct catalog details</DropdownMenuItem>{ordinaryItem(item) && <DropdownMenuItem onSelect={() => onAction(item.is_active ? 'retire' : 'reactivate', item)}>{item.is_active ? 'Review retirement' : 'Review reactivation'}</DropdownMenuItem>}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>}</div></TableCell>
    </TableRow>)}</TableBody></Table></div>;
}
