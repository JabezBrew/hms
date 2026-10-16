import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
export function NoteUnavailable({ open, onClose, title = 'Clinical note unavailable', children }) {
  if (!open) return null;
  return <Dialog open onOpenChange={(next) => { if (!next) onClose?.(); }}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{children || 'Open this note from the patient’s Chronicle with current full clinical access and the required clinical permission.'}</DialogDescription></DialogHeader><Button type="button" variant="outline" onClick={onClose}>Close</Button></DialogContent></Dialog>;
}
