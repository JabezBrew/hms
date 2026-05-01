import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useApproveInternalRequisition,
  useCancelInternalRequisition,
  useFulfillInternalRequisition,
  useInternalRequisition,
  useRejectInternalRequisition,
  useSubmitInternalRequisition,
} from '@/features/inventory/hooks';
import Check from 'lucide-react/dist/esm/icons/check.js';
import PackageCheck from 'lucide-react/dist/esm/icons/package-check.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import X from 'lucide-react/dist/esm/icons/x.js';

const STATUS_CONFIG = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground border-border' },
  pending_approval: { label: 'Pending Approval', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  approved: { label: 'Approved', className: 'bg-sky-500/10 text-sky-600 border-sky-500/30' },
  in_progress: { label: 'In Progress', className: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30' },
  fulfilled: { label: 'Fulfilled', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  partially_fulfilled: { label: 'Partially Fulfilled', className: 'bg-teal-500/10 text-teal-600 border-teal-500/30' },
  rejected: { label: 'Rejected', className: 'bg-rose-500/10 text-rose-600 border-rose-500/30' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground border-border' },
};

const TERMINAL_STATUSES = new Set(['fulfilled', 'partially_fulfilled', 'rejected', 'cancelled']);

function statusConfig(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.draft;
}

function formatDate(value) {
  if (!value) return 'Not set';
  try {
    return format(parseISO(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

export function InternalRequisitionDetailDialog({
  requisitionId,
  open,
  onOpenChange,
  mode = 'requester',
}) {
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectReason, setShowRejectReason] = useState(false);

  const { data: requisition, isLoading, error } = useInternalRequisition(open ? requisitionId : null);
  const submitMutation = useSubmitInternalRequisition();
  const approveMutation = useApproveInternalRequisition();
  const rejectMutation = useRejectInternalRequisition();
  const fulfillMutation = useFulfillInternalRequisition();
  const cancelMutation = useCancelInternalRequisition();

  const isInventoryMode = mode === 'inventory';
  const isBusy = submitMutation.isPending
    || approveMutation.isPending
    || rejectMutation.isPending
    || fulfillMutation.isPending
    || cancelMutation.isPending;

  const closeDialog = () => {
    setShowRejectReason(false);
    setRejectionReason('');
    onOpenChange?.(false);
  };

  const runAction = async (action, successMessage) => {
    if (!requisition?.id) return;
    try {
      await action();
      toast.success(successMessage);
      closeDialog();
    } catch (err) {
      toast.error(err.message || 'Unable to update request');
    }
  };

  const handleReject = async () => {
    const reason = rejectionReason.trim();
    if (!reason) {
      toast.error('Enter a rejection reason');
      return;
    }

    await runAction(
      () => rejectMutation.mutateAsync({ id: requisition.id, data: { reason } }),
      'Request rejected'
    );
  };

  const hasRequisition = Boolean(requisition?.id);
  const currentStatus = statusConfig(requisition?.status);
  const canSubmit = hasRequisition && !isInventoryMode && requisition?.status === 'draft';
  const canCancel = hasRequisition && (isInventoryMode
    ? !TERMINAL_STATUSES.has(requisition?.status)
    : ['draft', 'pending_approval'].includes(requisition?.status));
  const canApprove = hasRequisition && isInventoryMode && requisition?.status === 'pending_approval';
  const canReject = hasRequisition && isInventoryMode && requisition?.status === 'pending_approval';
  const canFulfill = hasRequisition && isInventoryMode && ['approved', 'in_progress'].includes(requisition?.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {requisition?.requisition_number || 'Internal Requisition'}
          </DialogTitle>
          <DialogDescription>
            Ward stock request and item issue details.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error.message || 'Unable to load request details'}
          </div>
        ) : requisition ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn('text-xs', currentStatus.className)}>
                {currentStatus.label}
              </Badge>
              <Badge variant="outline" className="font-mono text-xs capitalize">
                {requisition.priority || 'normal'} priority
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-card/40 p-3">
                <p className="font-mono text-[11px] uppercase text-muted-foreground">Requesting Store</p>
                <p className="mt-1 text-sm font-medium">{requisition.requesting_location_name}</p>
              </div>
              <div className="rounded-lg border bg-card/40 p-3">
                <p className="font-mono text-[11px] uppercase text-muted-foreground">Fulfilling Store</p>
                <p className="mt-1 text-sm font-medium">{requisition.fulfilling_location_name}</p>
              </div>
              <div className="rounded-lg border bg-card/40 p-3">
                <p className="font-mono text-[11px] uppercase text-muted-foreground">Requested By</p>
                <p className="mt-1 text-sm font-medium">{requisition.requested_by_name || 'Unknown'}</p>
              </div>
              <div className="rounded-lg border bg-card/40 p-3">
                <p className="font-mono text-[11px] uppercase text-muted-foreground">Required By</p>
                <p className="mt-1 text-sm font-medium">{formatDate(requisition.date_required)}</p>
              </div>
            </div>

            {requisition.justification ? (
              <div className="rounded-lg border bg-card/40 p-3">
                <p className="font-mono text-[11px] uppercase text-muted-foreground">Reason</p>
                <p className="mt-1 text-sm">{requisition.justification}</p>
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/60 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Requested</th>
                    <th className="px-3 py-2 font-medium">Approved</th>
                    <th className="px-3 py-2 font-medium">Issued</th>
                    <th className="px-3 py-2 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(requisition.items || []).map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="px-3 py-2">
                        <p className="font-medium">{item.item_name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{item.item_sku}</p>
                      </td>
                      <td className="px-3 py-2 font-mono">{item.quantity_requested}</td>
                      <td className="px-3 py-2 font-mono">{item.quantity_approved ?? '-'}</td>
                      <td className="px-3 py-2 font-mono">{item.quantity_issued ?? 0}</td>
                      <td className="px-3 py-2 text-muted-foreground">{item.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {showRejectReason ? (
              <div className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
                <label className="text-sm font-medium" htmlFor="rejection-reason">
                  Rejection reason
                </label>
                <Textarea
                  id="rejection-reason"
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="State why this ward stock request cannot be fulfilled."
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={closeDialog}>
            Close
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            {canCancel ? (
              <Button
                variant="outline"
                disabled={isBusy}
                onClick={() => runAction(
                  () => cancelMutation.mutateAsync(requisition.id),
                  'Request cancelled'
                )}
              >
                <X className="mr-2 h-4 w-4" />
                Cancel Request
              </Button>
            ) : null}
            {canSubmit ? (
              <Button
                disabled={isBusy}
                onClick={() => runAction(
                  () => submitMutation.mutateAsync(requisition.id),
                  'Request submitted'
                )}
              >
                <Send className="mr-2 h-4 w-4" />
                Submit
              </Button>
            ) : null}
            {canReject ? (
              showRejectReason ? (
                <Button variant="destructive" disabled={isBusy} onClick={handleReject}>
                  Reject
                </Button>
              ) : (
                <Button variant="outline" disabled={isBusy} onClick={() => setShowRejectReason(true)}>
                  Reject
                </Button>
              )
            ) : null}
            {canApprove ? (
              <Button
                disabled={isBusy}
                onClick={() => runAction(
                  () => approveMutation.mutateAsync(requisition.id),
                  'Request approved'
                )}
              >
                <Check className="mr-2 h-4 w-4" />
                Approve
              </Button>
            ) : null}
            {canFulfill ? (
              <Button
                disabled={isBusy}
                onClick={() => runAction(
                  () => fulfillMutation.mutateAsync(requisition.id),
                  'Stock issued'
                )}
              >
                <PackageCheck className="mr-2 h-4 w-4" />
                Fulfill
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
