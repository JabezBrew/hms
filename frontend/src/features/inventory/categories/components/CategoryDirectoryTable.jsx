import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { displayText } from '../model';
export function CategoryDirectoryTable({ rows, onView }) {
  return <div className="min-w-0 max-w-full overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Direct parent</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{rows.map(category => <TableRow key={category.id}>
    <TableCell className="min-w-40 max-w-80 whitespace-normal [overflow-wrap:anywhere]"><p className="font-medium">{displayText(category.name)}</p><p className="mt-1 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{category.code} · Revision {category.version}</p></TableCell><TableCell className="min-w-32 max-w-72 whitespace-normal [overflow-wrap:anywhere]">{category.parent_id === null ? 'No direct parent' : 'Recorded direct parent'}</TableCell><TableCell><Badge variant="secondary">{category.is_active ? 'Active' : 'Retired'}</Badge></TableCell><TableCell><Button type="button" variant="outline" size="sm" onClick={() => onView(category.id)} aria-label={`View category details for ${displayText(category.name)}`}>View details</Button></TableCell>
  </TableRow>)}</TableBody></Table></div>;
}
