import Package from 'lucide-react/dist/esm/icons/package.js';
import MoreVertical from 'lucide-react/dist/esm/icons/ellipsis-vertical.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { toast } from 'sonner';
import format from 'date-fns/format';
import {
  useRequestSupply,
  useDiscontinueTreatmentEntry
} from '@/features/nursing/hooks';

// Supply Status Badge Component
function SupplyStatusBadge({ entry }) {
  // Legacy prescriptions don't have supply tracking
  if (entry.is_legacy_prescription) {
    return (
      <Badge variant="outline" className="gap-1">
        <Package className="h-3 w-3" />
        Legacy Rx
      </Badge>
    );
  }

  const daysRemaining = entry.days_of_supply_remaining;
  const dosesRemaining = entry.supply_remaining;

  if (dosesRemaining <= 0) {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        Out of stock
      </Badge>
    );
  }

  if (daysRemaining < 1) {
    return (
      <Badge className="bg-rose-600 gap-1">
        <AlertTriangle className="h-3 w-3" />
        {dosesRemaining} doses (&lt;1 day)
      </Badge>
    );
  }

  if (daysRemaining < 2) {
    return (
      <Badge className="bg-amber-600 gap-1">
        <AlertTriangle className="h-3 w-3" />
        {dosesRemaining} doses ({daysRemaining.toFixed(1)} days)
      </Badge>
    );
  }

  return (
    <Badge className="bg-emerald-600 gap-1">
      <CheckCircle className="h-3 w-3" />
      {dosesRemaining} doses ({daysRemaining.toFixed(1)} days)
    </Badge>
  );
}

export function TreatmentSheetGrid({ entries, onUpdate, readOnly = false }) {
  const [supplyDialog, setSupplyDialog] = useState({ open: false, entry: null });
  const [discontinueDialog, setDiscontinueDialog] = useState({ open: false, entry: null });
  const [supplyQuantity, setSupplyQuantity] = useState('');
  const [supplyNotes, setSupplyNotes] = useState('');
  const [discontinueReason, setDiscontinueReason] = useState('');

  const requestSupplyMutation = useRequestSupply();
  const discontinueMutation = useDiscontinueTreatmentEntry();

  const handleRequestSupply = async () => {
    if (!supplyQuantity || parseInt(supplyQuantity) <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    try {
      await requestSupplyMutation.mutateAsync({
        entryId: supplyDialog.entry.id,
        quantity: parseInt(supplyQuantity),
        notes: supplyNotes
      });

      toast.success(`Supply request for ${supplyQuantity} doses sent to pharmacy`);
      setSupplyDialog({ open: false, entry: null });
      setSupplyQuantity('');
      setSupplyNotes('');
      onUpdate?.();
    } catch (error) {
      toast.error(`Failed to request supply: ${error.message}`);
    }
  };

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

  // Calculate suggested supply (3 days worth)
  const calculateSuggestedSupply = (entry) => {
    // Parse frequency to daily doses
    const freq = entry.frequency.toLowerCase();
    let dailyDoses = 1;

    if (freq.includes('bid') || freq.includes('twice')) dailyDoses = 2;
    else if (freq.includes('tid') || freq.includes('three')) dailyDoses = 3;
    else if (freq.includes('qid') || freq.includes('four')) dailyDoses = 4;
    else if (freq.includes('q4h')) dailyDoses = 6;
    else if (freq.includes('q6h')) dailyDoses = 4;
    else if (freq.includes('q8h')) dailyDoses = 3;
    else if (freq.includes('q12h')) dailyDoses = 2;

    return dailyDoses * 3; // 3 days worth
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
              <TableHead>Supply Status</TableHead>
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
                <TableCell>
                  <SupplyStatusBadge entry={entry} />
                  {!entry.is_legacy_prescription && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {entry.total_doses_administered}/{entry.total_doses_dispensed} administered
                    </div>
                  )}
                  {entry.is_legacy_prescription && (
                    <div className="text-xs text-muted-foreground mt-1">
                      From existing prescription
                    </div>
                  )}
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
                        {!entry.is_legacy_prescription && (
                          <>
                            <DropdownMenuItem
                              onClick={() => {
                                setSupplyDialog({ open: true, entry });
                                setSupplyQuantity(calculateSuggestedSupply(entry).toString());
                              }}
                            >
                              <Package className="h-4 w-4 mr-2" />
                              Request Supply
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
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

      {/* Request Supply Dialog */}
      <Dialog open={supplyDialog.open} onOpenChange={(open) => {
        if (!open) {
          setSupplyDialog({ open: false, entry: null });
          setSupplyQuantity('');
          setSupplyNotes('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Medication Supply</DialogTitle>
            <DialogDescription>
              {supplyDialog.entry && (
                <>Request supply from pharmacy for <span className="font-semibold">{supplyDialog.entry.medication_name}</span></>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="quantity">Quantity (doses)</Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={supplyQuantity}
                onChange={(e) => setSupplyQuantity(e.target.value)}
                placeholder="Enter number of doses"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Suggested: {supplyDialog.entry && calculateSuggestedSupply(supplyDialog.entry)} doses (3 days supply)
              </p>
            </div>

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={supplyNotes}
                onChange={(e) => setSupplyNotes(e.target.value)}
                placeholder="Any special instructions..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSupplyDialog({ open: false, entry: null });
                setSupplyQuantity('');
                setSupplyNotes('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRequestSupply}
              disabled={requestSupplyMutation.isPending}
            >
              {requestSupplyMutation.isPending ? 'Requesting...' : 'Request Supply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
