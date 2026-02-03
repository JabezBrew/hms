import Package from 'lucide-react/dist/esm/icons/package.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
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

import { toast } from 'sonner';
import format from 'date-fns/format';
import {
  usePendingSupplyRequests,
  useDispenseSupply,
  useRejectSupplyRequest,
  useBulkDispenseSupply
} from '@/hooks/useNursingQueries';

export default function SupplyQueuePage() {
  const {
    data: requests = [],
    isLoading,
    error,
    refetch
  } = usePendingSupplyRequests();

  const [selectedRequests, setSelectedRequests] = useState([]);
  const [dispenseDialog, setDispenseDialog] = useState({ open: false, request: null });
  const [rejectDialog, setRejectDialog] = useState({ open: false, request: null });
  const [dispenseQuantity, setDispenseQuantity] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const dispenseMutation = useDispenseSupply();
  const rejectMutation = useRejectSupplyRequest();
  const bulkDispenseMutation = useBulkDispenseSupply();

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedRequests(requests.map(r => r.id));
    } else {
      setSelectedRequests([]);
    }
  };

  const handleSelectRequest = (requestId, checked) => {
    if (checked) {
      setSelectedRequests([...selectedRequests, requestId]);
    } else {
      setSelectedRequests(selectedRequests.filter(id => id !== requestId));
    }
  };

  const handleDispense = async () => {
    if (!dispenseQuantity || parseInt(dispenseQuantity) <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    try {
      await dispenseMutation.mutateAsync({
        requestId: dispenseDialog.request.id,
        quantityDispensed: parseInt(dispenseQuantity)
      });

      toast.success('Supply dispensed successfully');
      setDispenseDialog({ open: false, request: null });
      setDispenseQuantity('');
      refetch();
    } catch (error) {
      toast.error(`Failed to dispense: ${error.message}`);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }

    try {
      await rejectMutation.mutateAsync({
        requestId: rejectDialog.request.id,
        reason: rejectReason
      });

      toast.success('Request rejected');
      setRejectDialog({ open: false, request: null });
      setRejectReason('');
      refetch();
    } catch (error) {
      toast.error(`Failed to reject: ${error.message}`);
    }
  };

  const handleBulkDispense = async () => {
    if (selectedRequests.length === 0) {
      toast.error('Please select at least one request');
      return;
    }

    try {
      const result = await bulkDispenseMutation.mutateAsync(selectedRequests);

      if (result.errors && result.errors.length > 0) {
        toast.warning(`Dispensed ${result.dispensed_count} requests. ${result.errors.length} errors occurred.`);
      } else {
        toast.success(`${result.dispensed_count} requests dispensed successfully`);
      }

      setSelectedRequests([]);
      refetch();
    } catch (error) {
      toast.error(`Bulk dispense failed: ${error.message}`);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 space-y-4">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load supply queue: {error.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display">Supply Request Queue</h1>
          <p className="text-muted-foreground">
            Pending medication supply requests from nursing staff
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {selectedRequests.length > 0 && (
            <Button
              onClick={handleBulkDispense}
              disabled={bulkDispenseMutation.isPending}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Dispense Selected ({selectedRequests.length})
            </Button>
          )}
        </div>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Queue Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div>
              <div className="text-2xl font-bold">{requests.length}</div>
              <div className="text-sm text-muted-foreground">Pending Requests</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{selectedRequests.length}</div>
              <div className="text-sm text-muted-foreground">Selected</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Requests Table */}
      {requests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">No pending supply requests</p>
            <p className="text-sm">All requests have been processed</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedRequests.length === requests.length}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>MRN</TableHead>
                <TableHead>Ward</TableHead>
                <TableHead>Medication</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Requested At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedRequests.includes(request.id)}
                      onCheckedChange={(checked) => handleSelectRequest(request.id, checked)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{request.patient_name}</TableCell>
                  <TableCell className="font-mono text-sm">{request.patient_mrn}</TableCell>
                  <TableCell>{request.ward_name}</TableCell>
                  <TableCell className="font-medium">{request.medication_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{request.quantity_requested} doses</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {request.requested_by_name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(request.requested_at), 'MMM d, h:mm a')}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => {
                        setDispenseDialog({ open: true, request });
                        setDispenseQuantity(request.quantity_requested.toString());
                      }}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Dispense
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setRejectDialog({ open: true, request })}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Dispense Dialog */}
      <Dialog open={dispenseDialog.open} onOpenChange={(open) => {
        if (!open) {
          setDispenseDialog({ open: false, request: null });
          setDispenseQuantity('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispense Supply Request</DialogTitle>
            <DialogDescription>
              {dispenseDialog.request && (
                <div className="space-y-2 mt-2">
                  <div><span className="font-semibold">Patient:</span> {dispenseDialog.request.patient_name}</div>
                  <div><span className="font-semibold">Medication:</span> {dispenseDialog.request.medication_name}</div>
                  <div><span className="font-semibold">Requested:</span> {dispenseDialog.request.quantity_requested} doses</div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="dispense-quantity">Quantity to Dispense (doses)</Label>
            <Input
              id="dispense-quantity"
              type="number"
              min="1"
              value={dispenseQuantity}
              onChange={(e) => setDispenseQuantity(e.target.value)}
              placeholder="Enter quantity"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Can dispense less than requested if partial stock available
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDispenseDialog({ open: false, request: null });
                setDispenseQuantity('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDispense}
              disabled={dispenseMutation.isPending}
            >
              {dispenseMutation.isPending ? 'Dispensing...' : 'Dispense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialog.open} onOpenChange={(open) => {
        if (!open) {
          setRejectDialog({ open: false, request: null});
          setRejectReason('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Supply Request</DialogTitle>
            <DialogDescription>
              {rejectDialog.request && (
                <div className="space-y-2 mt-2">
                  <div><span className="font-semibold">Patient:</span> {rejectDialog.request.patient_name}</div>
                  <div><span className="font-semibold">Medication:</span> {rejectDialog.request.medication_name}</div>
                  <div><span className="font-semibold">Quantity:</span> {rejectDialog.request.quantity_requested} doses</div>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="reject-reason">Reason for Rejection *</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g., Out of stock, medication discontinued..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectDialog({ open: false, request: null });
                setRejectReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
