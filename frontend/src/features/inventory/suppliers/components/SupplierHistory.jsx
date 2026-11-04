import { Badge } from '@/components/ui/badge';
import { PageState } from '@/shared/components/page/PageState';
const actions = { create: 'Supplier created', correct: 'Metadata correction', retire: 'Supplier retired', reactivate: 'Supplier reactivated' };
export function SupplierHistory({ rows, loading, error, onRetry }) {
  if (error) return <PageState variant="error" title="Supplier history unavailable" action={onRetry} fullHeight={false} />;
  if (loading) return <PageState variant="loading" title="Loading supplier history" fullHeight={false} />;
  if (!rows.length) return <PageState variant="empty" title="No supplier records on this page" fullHeight={false} />;
  return <ol aria-label="Supplier recording history" className="grid min-w-0 gap-4">{rows.map(row => <li key={row.id} className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex min-w-0 flex-wrap justify-between gap-3"><div className="min-w-0"><h3 className="font-medium">{actions[row.action]}</h3><p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">Recorded: <span className="font-mono">{row.recorded_at}</span></p></div><Badge variant="secondary">{row.before_version === null || row.after_version !== row.before_version ? 'State changed' : 'State unchanged'}</Badge></div>
    <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-muted-foreground">Before revision</dt><dd className="font-mono">{row.before_version ?? 'New supplier'}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Recorded revision</dt><dd className="font-mono">{row.after_version}</dd></div></dl>
    <ul className="flex flex-wrap gap-2 text-sm" aria-label="Recorded metadata changes">{[['name_changed', 'Name changed'], ['contact_name_changed', 'Contact name changed'], ['phone_changed', 'Phone changed'], ['email_changed', 'Email changed'], ['address_changed', 'Address changed'], ['active_changed', 'Active state changed']].filter(([key]) => row[key]).map(([key, label]) => <li key={key}><Badge variant="outline">{label}</Badge></li>)}</ul>
  </li>)}</ol>;
}
