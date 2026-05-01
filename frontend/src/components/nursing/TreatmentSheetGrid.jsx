import MoreVertical from 'lucide-react/dist/esm/icons/ellipsis-vertical.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { toast } from 'sonner';
import format from 'date-fns/format';
import { useDiscontinueTreatmentEntry } from '@/features/nursing/hooks';

export function TreatmentSheetGrid({ entries, onUpdate, readOnly = false }) {
  const [discontinueDialog, setDiscontinueDialog] = useState({ open: false, entry: null });
  const [discontinueReason, setDiscontinueReason] = useState('');

  const discontinueMutation = useDiscontinueTreatmentEntry();

  const handleDiscontinue = async () => {
    if (!discontinueReason.trim()) {
      toast.error('Please provide a reason for discontinuation');
      return;
    }

    try {
      await discontinueMutation.mutateAsync({
        entryId: discontinueDialog.entry.id,
        reason: discontinueReason
      });

      toast.success(`${discontinueDialog.entry.medication_name} discontinued`);
      setDiscontinueDialog({ open: false, entry: null });
      setDiscontinueReason('');
      onUpdate?.();
    } catch (error) {
      toast.error(`Failed to discontinue: ${error.message}`);
    }
  };

  return (
    <>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medication</TableHead>
              <TableHead>Dosage</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Frequency</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Ordered By</TableHead>
              <TableHead>Administration</TableHead>
              {!readOnly && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">{entry.medication_name}</TableCell>
                <TableCell>{entry.dosage}</TableCell>
                <TableCell>{entry.route}</TableCell>
                <TableCell>{entry.frequency}</TableCell>
                <TableCell>
                  {format(new Date(entry.start_datetime), 'MMM d, h:mm a')}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {entry.ordered_by_name}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {entry.is_legacy_prescription
                    ? 'From existing prescription'
                    : `${entry.total_doses_administered}/${entry.total_doses_ordered} doses`}
                </TableCell>
                {!readOnly && (
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setDiscontinueDialog({ open: true, entry })}
                          className="text-rose-600"
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Discontinue
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Discontinue Dialog */}
      <Dialog open={discontinueDialog.open} onOpenChange={(open) => {
        if (!open) {
          setDiscontinueDialog({ open: false, entry: null });
          setDiscontinueReason('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discontinue Medication</DialogTitle>
            <DialogDescription>
              {discontinueDialog.entry && (
                <>Are you sure you want to discontinue <span className="font-semibold">{discontinueDialog.entry.medication_name}</span>?</>
              )}
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="reason">Reason for discontinuation *</Label>
            <Textarea
              id="reason"
              value={discontinueReason}
              onChange={(e) => setDiscontinueReason(e.target.value)}
              placeholder="Enter reason for discontinuation..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDiscontinueDialog({ open: false, entry: null });
                setDiscontinueReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDiscontinue}
              disabled={discontinueMutation.isPending}
            >
              {discontinueMutation.isPending ? 'Discontinuing...' : 'Discontinue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
