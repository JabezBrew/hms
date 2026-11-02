import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { displayText } from '../model';
import { CategoryValues } from './CategoryValues';
export function CategoryCurrent({ category, eligibility, access, onAction, disabled }) {
  const blocked = eligibility.lifecycle_blocked_by;
  return <section className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-heading text-xl font-semibold [overflow-wrap:anywhere]">{displayText(category.name)}</h2><p className="mt-1 whitespace-pre-wrap font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">{category.code}</p></div><Badge variant="secondary">{category.is_active ? 'Active' : 'Retired'}</Badge></div>
    <CategoryValues value={category} />
    <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-muted-foreground">Permanent category identity</dt><dd className="font-mono [overflow-wrap:anywhere]">{category.id}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Created</dt><dd className="font-mono [overflow-wrap:anywhere]">{category.created_at}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Category changed</dt><dd className="font-mono [overflow-wrap:anywhere]">{category.catalog_changed_at ?? 'No governed category change recorded'}</dd></div></dl>
    {eligibility.parent_unavailable && <p className="text-sm text-muted-foreground">The recorded parent pointer is retained. Its current local observation is unavailable; keeping it does not repair it.</p>}
    {access.canManage && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={disabled || !access.canWrite} onClick={() => onAction({ action: 'correct', category, eligibility })}>Correct category details</Button><Button type="button" variant="outline" disabled={disabled || !access.canWrite || Boolean(blocked)} onClick={() => onAction({ action: category.is_active ? 'retire' : 'reactivate', category, eligibility })}>{category.is_active ? 'Review category retirement' : 'Review category reactivation'}</Button></div>}
    <p className="text-sm text-muted-foreground">{blocked ? `A retained ${blocked === 'item_reference' ? 'item' : 'current child'} reference blocks active-state changes, including inactive or malformed references. Metadata correction remains available.` : 'Active state can change only for unused categories. The server rechecks current item and child references transactionally.'}</p>
  </section>;
}
