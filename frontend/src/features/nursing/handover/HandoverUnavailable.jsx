import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function HandoverUnavailable({ open, onClose, title = 'Patient handover unavailable', children }) {
  if (!open) return null;
  return <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{children || 'Current nursing workflow, full clinical visibility and access to this admission’s ward are required.'}</DialogDescription></DialogHeader>
      <Button type="button" variant="outline" onClick={onClose}>Close</Button>
    </DialogContent>
  </Dialog>;
}
