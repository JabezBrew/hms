import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function FluidUnavailable({ open, onClose, onRetry, title = 'Fluid balance unavailable', children }) {
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{children || 'Current full clinical access, nursing workflow permission and ward access are required. Refresh your access before continuing.'}</DialogDescription></DialogHeader><div className="flex flex-wrap gap-2">{onRetry && <Button type="button" variant="outline" onClick={onRetry}>Recheck current fluid access</Button>}<Button type="button" variant="outline" onClick={onClose}>Close</Button></div></DialogContent></Dialog>;
}
