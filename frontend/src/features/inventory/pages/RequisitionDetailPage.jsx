import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useRequisition,
  useApproveRequisition,
  useRejectRequisition,
  useConvertRequisitionToPO,
} from '@/features/inventory/hooks';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import ArrowRightCircle from 'lucide-react/dist/esm/icons/arrow-right-circle.js';

const USD_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

const US_NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'text-slate-500', bgColor: 'bg-slate-500/10' },
  pending: { label: 'Pending Approval', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  approved: { label: 'Approved', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  rejected: { label: 'Rejected', color: 'text-rose-500', bgColor: 'bg-rose-500/10' },
  converted: { label: 'Converted to PO', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  cancelled: { label: 'Cancelled', color: 'text-muted-foreground', bgColor: 'bg-muted' },
};

const PRIORITY_CONFIG = {
  low: { label: 'Low', color: 'text-slate-500' },
  normal: { label: 'Normal', color: 'text-sky-500' },
  high: { label: 'High', color: 'text-amber-500' },
  urgent: { label: 'Urgent', color: 'text-rose-500' },
};

function getStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || { label: status || 'Unknown', color: 'text-muted-foreground', bgColor: 'bg-muted' };
}

function getPriorityConfig(priority) {
  return PRIORITY_CONFIG[priority?.toLowerCase()] || { label: priority || 'Normal', color: 'text-muted-foreground' };
}

function formatCurrency(amount) {
  return USD_CURRENCY_FORMATTER.format(amount || 0);
}

function formatNumber(value) {
  return US_NUMBER_FORMATTER.format(value || 0);
}

/**
 * RequisitionDetailPage - Requisition detail with approval workflow
 */
export default function RequisitionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [convertDialogOpen, setConvertDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const { data: requisition, isLoading, error, refetch } = useRequisition(id);

  const approveMutation = useApproveRequisition();
  const rejectMutation = useRejectRequisition();
  const convertMutation = useConvertRequisitionToPO();

  const handleBack = () => {
    navigate('/inventory/requisitions');
  };

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync(id);
      toast.success('Requisition approved');
    } catch (error) {
      toast.error(error.message || 'Failed to approve requisition');
    }
  };

  const handleReject = async () => {
    try {
      await rejectMutation.mutateAsync({ id, data: { reason: rejectReason } });
      toast.success('Requisition rejected');
      setRejectDialogOpen(false);
      setRejectReason('');
    } catch (error) {
      toast.error(error.message || 'Failed to reject requisition');
    }
  };

  const handleConvert = async () => {
    try {
      const result = await convertMutation.mutateAsync({ id, data: {} });
      toast.success('Requisition converted to Purchase Order');
      setConvertDialogOpen(false);
      if (result?.id) {
        navigate(`/inventory/purchase-orders/${result.id}`);
      }
    } catch (error) {
      toast.error(error.message || 'Failed to convert requisition');
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <PageState variant="loading" fullHeight={false} className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-10" />
          <div>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-48 mt-2" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64" />
            <Skeleton className="h-48" />
          </div>
          <Skeleton className="h-80" />
        </div>
      </PageState>
    );
  }

  // Error state
  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Requisition"
        description={error.message}
        action={(
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="size-4 mr-2" />
              Back to Requisitions
            </Button>
            <Button onClick={() => refetch()}>
              <RefreshCw className="size-4 mr-2" />
              Retry
            </Button>
          </div>
        )}
      />
    );
  }

  // Not found
  if (!requisition) {
    return (
      <PageState
        variant="empty"
        title="Requisition Not Found"
        description="The requested requisition does not exist or has been deleted."
        action={(
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="size-4 mr-2" />
            Back to Requisitions
          </Button>
        )}
      />
    );
  }

  const statusConfig = getStatusConfig(requisition.status);
  const priorityConfig = getPriorityConfig(requisition.priority);
  const items = requisition.items || requisition.requisition_items || [];
  const totalAmount = items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unit_price || item.estimated_price || 0), 0);
  const requisitionConversionAvailable = !isRustV2ApiMode();

  const canApprove = requisition.status === 'pending';
  const canConvert = requisitionConversionAvailable && requisition.status === 'approved';

  return (
    <PageShell>
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <span>{requisition.requisition_number || `REQ-${id}`}</span>
            <Badge className={cn('text-xs', statusConfig.bgColor, statusConfig.color)}>
              {statusConfig.label}
            </Badge>
          </span>
        )}
        description={(
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="size-4" />
              <span className="text-sm">
                {requisition.created_at
                  ? format(parseISO(requisition.created_at), 'MMM d, yyyy')
                  : 'N/A'}
              </span>
            </span>
            <Badge variant="outline" className={cn('text-xs', priorityConfig.color)}>
              {priorityConfig.label} Priority
            </Badge>
          </div>
        )}
        actions={(
          <div className="flex items-center gap-2 shrink-0">
            {canApprove && (
              <>
                <Button variant="outline" onClick={() => setRejectDialogOpen(true)}>
                  <X className="size-4 mr-2" />
                  Reject
                </Button>
                <Button onClick={handleApprove} disabled={approveMutation.isPending}>
                  {approveMutation.isPending ? (
                    <Loader2 className="size-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="size-4 mr-2" />
                  )}
                  Approve
                </Button>
              </>
            )}
            {canConvert && (
              <Button onClick={() => setConvertDialogOpen(true)}>
                <ShoppingCart className="size-4 mr-2" />
                Convert to PO
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <Printer className="size-4 mr-2" />
                  Print
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => refetch()}>
                  <RefreshCw className="size-4 mr-2" />
                  Refresh
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          className="w-fit -ml-2"
          onClick={handleBack}
        >
          <ArrowLeft className="size-4 mr-2" />
          Back to Requisitions
        </Button>
      </PageHeader>

      <div className="p-4 sm:p-6 space-y-6">
        {!requisitionConversionAvailable && requisition.status === 'approved' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Requisition conversion to purchase order is not available in Rust V2 mode yet.
            Create purchase orders directly until the generated /api/v2 stock requisition
            conversion contract exists.
          </div>
        )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items Table */}
          <Card className="bg-card/30 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Items ({items.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="border-t border-border overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                        Item
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                        Qty
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                        Unit Price
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map((item, index) => (
                      <tr key={item.id || index} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium">{item.item_name || item.name}</p>
                            {item.sku && (
                              <p className="text-xs font-mono text-muted-foreground">{item.sku}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {formatNumber(item.quantity)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm">
                          {formatCurrency(item.unit_price || item.estimated_price)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                          {formatCurrency((item.quantity || 0) * (item.unit_price || item.estimated_price || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/50 border-t border-border">
                    <tr>
                      <td colSpan="3" className="px-4 py-3 text-right text-sm font-medium">
                        Total Amount
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-lg font-semibold text-emerald-500">
                        {formatCurrency(totalAmount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          {requisition.notes && (
            <Card className="bg-card/30 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {requisition.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Rejection Reason */}
          {requisition.status === 'rejected' && requisition.rejection_reason && (
            <Card className="bg-rose-500/5 border-rose-500/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-rose-500">Rejection Reason</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {requisition.rejection_reason}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Details Card */}
          <Card className="bg-card/30 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <User className="size-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Requested By</p>
                  <p className="text-sm">{requisition.requested_by_name || requisition.created_by_name || 'N/A'}</p>
                </div>
              </div>

              {requisition.department_name && (
                <div className="flex items-start gap-3">
                  <MapPin className="size-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Department</p>
                    <p className="text-sm">{requisition.department_name}</p>
                  </div>
                </div>
              )}

              {requisition.required_date && (
                <div className="flex items-start gap-3">
                  <Calendar className="size-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Required By</p>
                    <p className="text-sm font-mono">
                      {format(parseISO(requisition.required_date), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
              )}

              {requisition.approved_by_name && (
                <div className="flex items-start gap-3">
                  <Check className="size-4 mt-0.5 text-emerald-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Approved By</p>
                    <p className="text-sm">{requisition.approved_by_name}</p>
                    {requisition.approved_at && (
                      <p className="text-xs font-mono text-muted-foreground">
                        {format(parseISO(requisition.approved_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {requisition.purchase_order && (
                <div className="flex items-start gap-3">
                  <ArrowRightCircle className="size-4 mt-0.5 text-sky-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Purchase Order</p>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-sm"
                      onClick={() => navigate(`/inventory/purchase-orders/${requisition.purchase_order}`)}
                    >
                      {requisition.purchase_order_number || `PO-${requisition.purchase_order}`}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Timeline */}
          <Card className="bg-card/30 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {requisition.created_at && (
                  <div className="flex items-start gap-3">
                    <div className="size-2 rounded-full bg-sky-500 mt-2" />
                    <div>
                      <p className="text-sm">Created</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {format(parseISO(requisition.created_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                )}
                {requisition.submitted_at && (
                  <div className="flex items-start gap-3">
                    <div className="size-2 rounded-full bg-amber-500 mt-2" />
                    <div>
                      <p className="text-sm">Submitted for Approval</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {format(parseISO(requisition.submitted_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                )}
                {requisition.approved_at && (
                  <div className="flex items-start gap-3">
                    <div className="size-2 rounded-full bg-emerald-500 mt-2" />
                    <div>
                      <p className="text-sm">Approved</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {format(parseISO(requisition.approved_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                )}
                {requisition.rejected_at && (
                  <div className="flex items-start gap-3">
                    <div className="size-2 rounded-full bg-rose-500 mt-2" />
                    <div>
                      <p className="text-sm">Rejected</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {format(parseISO(requisition.rejected_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Requisition</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this requisition.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Enter rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <X className="size-4 mr-2" />
              )}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert Dialog */}
      <Dialog open={convertDialogOpen} onOpenChange={setConvertDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert to Purchase Order</DialogTitle>
            <DialogDescription>
              This will create a new Purchase Order with all items from this requisition.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Items</span>
                <span className="font-mono">{items.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Amount</span>
                <span className="font-mono font-semibold text-emerald-500">
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConvert} disabled={convertMutation.isPending}>
              {convertMutation.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <ShoppingCart className="size-4 mr-2" />
              )}
              Create Purchase Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </PageShell>
  );
}
