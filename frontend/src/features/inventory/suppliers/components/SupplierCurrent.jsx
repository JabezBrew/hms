import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { displayText } from '../model';
import { SupplierValues } from './SupplierValues';
export function SupplierCurrent({ supplier, eligibility, access, onAction, disabled }) {
  const blocked = eligibility.lifecycle_blocked_by;
  return <section className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-heading text-xl font-semibold [overflow-wrap:anywhere]">{displayText(supplier.name)}</h2><p className="mt-1 whitespace-pre-wrap font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">{supplier.code}</p></div><Badge variant="secondary">{supplier.is_active ? 'Active' : 'Retired'}</Badge></div>
    <SupplierValues value={supplier} />
    <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-muted-foreground">Supplier reference</dt><dd className="font-mono [overflow-wrap:anywhere]">{supplier.id}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Created</dt><dd className="font-mono [overflow-wrap:anywhere]">{supplier.created_at}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Supplier changed</dt><dd className="font-mono [overflow-wrap:anywhere]">{supplier.catalog_changed_at ?? 'Not recorded'}</dd></div></dl>

    {access.canManage && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={disabled || !access.canWrite} onClick={() => onAction({ action: 'correct', supplier, eligibility })}>Correct supplier details</Button><Button type="button" variant="outline" disabled={disabled || !access.canWrite || Boolean(blocked)} onClick={() => onAction({ action: supplier.is_active ? 'retire' : 'reactivate', supplier, eligibility })}>{supplier.is_active ? 'Review supplier retirement' : 'Review supplier reactivation'}</Button></div>}
    <p className="text-sm text-muted-foreground">{blocked ? 'A retained item reference blocks active-state changes, including inactive or malformed references. Metadata correction remains available.' : 'Active state can change only for unused suppliers. The server rechecks current item references transactionally.'}</p>
  </section>;
}
