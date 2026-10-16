import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
export function HistoricalRequestDialog({ request, onClose }) {
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent><DialogHeader><DialogTitle>Stock request summary</DialogTitle><DialogDescription>This older request has no item list available for review. Stock cannot be issued from this summary.</DialogDescription></DialogHeader><dl className="grid grid-cols-[auto_1fr] gap-3 text-sm"><dt>Location</dt><dd>{request.requesting_location_name}</dd><dt>Status</dt><dd>{request.status}</dd></dl><p className="text-sm text-muted-foreground">Create a standing template with exact items and quantities for a request that can be reviewed and issued.</p><DialogFooter><Button type="button" variant="outline" onClick={onClose}>Done</Button></DialogFooter></DialogContent></Dialog>;
}
