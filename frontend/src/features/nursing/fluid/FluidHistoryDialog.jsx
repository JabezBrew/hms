import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useFluidHistory } from './hooks';
import { fluidTime } from './model';
import { FluidMetadataDetails } from './FluidMetadataDetails';
export function FluidHistoryDialog({ source, onClose, open = true }) {
  const query = useFluidHistory(source.id, open);
  const rows = query.data?.pages.flatMap((p) => p.rows) || [];
  return <Dialog open={open} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Fluid observation history</DialogTitle><DialogDescription>Original recorded values and every correction or void remain visible. Only the current entry contributes to totals.</DialogDescription></DialogHeader>
    {query.isError && <p role="alert" className="text-sm text-destructive">History could not be completed. Displayed records may be incomplete. <Button variant="outline" onClick={() => query.refetch()}>Refresh history</Button></p>}
    {query.isPending && <p role="status">Loading history…</p>}
    <ol className="grid gap-3">{rows.map((row) => <li key={row.id} className="grid gap-2 rounded-xl border p-4"><p className="font-medium">Revision {row.revision} · {row.current ? 'Current' : row.closed_by_action === 'voided' ? 'Voided' : 'Corrected'}</p><p className="text-sm">Observed {fluidTime(row.values.recorded_at)} · Intake {row.values.intake_ml} ml · Output {row.values.output_ml} ml</p><p className="text-xs text-muted-foreground">Recorded {fluidTime(row.created_at)} by {row.recorded_by_display_name || 'Earlier record: author unavailable'}</p><FluidMetadataDetails values={row.values} />{row.correction_reason && <div className="grid gap-1 border-t pt-2 text-sm"><p>Reason: {row.correction_reason}</p><p className="text-xs text-muted-foreground">{row.closed_by_action === 'voided' ? 'Voided' : 'Corrected'} {fluidTime(row.closed_at)} by {row.closed_by_display_name || 'Recorded clinician'}</p></div>}</li>)}</ol>
    {query.hasNextPage && <Button type="button" variant="outline" disabled={query.isFetchingNextPage || query.isError} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : 'Load earlier revisions'}</Button>}
    <Button type="button" variant="outline" onClick={onClose}>Close history</Button>
  </DialogContent></Dialog>;
}
