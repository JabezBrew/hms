import { useParams, useNavigate } from 'react-router-dom';
import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
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
  usePurchaseOrder,
  useApprovePurchaseOrder,
  useSendPurchaseOrder,
} from '@/features/inventory/hooks';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';

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
  sent: { label: 'Sent to Supplier', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  acknowledged: { label: 'Acknowledged', color: 'text-violet-500', bgColor: 'bg-violet-500/10' },
  receiving: { label: 'Receiving', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  partially_received: { label: 'Partially Received', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  received: { label: 'Received', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  closed: { label: 'Closed', color: 'text-muted-foreground', bgColor: 'bg-muted' },
  cancelled: { label: 'Cancelled', color: 'text-rose-500', bgColor: 'bg-rose-500/10' },
};

function getStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || { label: status || 'Unknown', color: 'text-muted-foreground', bgColor: 'bg-muted' };
}

function formatCurrency(amount) {
  return USD_CURRENCY_FORMATTER.format(amount || 0);
}

function formatNumber(value) {
  return US_NUMBER_FORMATTER.format(value || 0);
}

function buildPurchaseOrderSummary(po) {
  const items = po.items || po.purchase_order_items || [];
  const grns = po.grns || po.goods_received_notes || [];
  const totalAmount = po.total_amount || items.reduce((sum, item) => (
    sum + (item.quantity || 0) * (item.unit_price || 0)
  ), 0);
  const totalOrdered = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalReceived = items.reduce((sum, item) => sum + (item.received_quantity || 0), 0);

  return {
    items,
    grns,
    totalAmount,
    totalOrdered,
    totalReceived,
    receivedProgress: totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0,
    canApprove: ['draft', 'pending', 'pending_approval'].includes(po.status),
    canSend: po.status === 'approved',
    canReceive: ['sent', 'acknowledged', 'receiving', 'partially_received'].includes(po.status),
  };
}

function PurchaseOrderLoadingState() {
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

function PurchaseOrderErrorState({ error, onBack, onRetry }) {
  return (
    <PageState
      variant="error"
      title="Error Loading Purchase Order"
      description={error.message}
      action={(
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="size-4 mr-2" />
            Back to Purchase Orders
          </Button>
          <Button onClick={onRetry}>
            <RefreshCw className="size-4 mr-2" />
            Retry
          </Button>
        </div>
      )}
    />
  );
}

function PurchaseOrderEmptyState({ onBack }) {
  return (
    <PageState
      variant="empty"
      title="Purchase Order Not Found"
      description="The requested purchase order does not exist or has been deleted."
      action={(
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Purchase Orders
        </Button>
      )}
    />
  );
}

function PurchaseOrderHeader({
  po,
  id,
  statusConfig,
  canApprove,
  canSend,
  canReceive,
  approvePending,
  onBack,
  onApprove,
  onOpenSendDialog,
  onCreateGRN,
  onRefresh,
}) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <span>{po.po_number || `PO-${id}`}</span>
          <Badge className={cn('text-xs', statusConfig.bgColor, statusConfig.color)}>
            {statusConfig.label}
          </Badge>
        </span>
      )}
      description={(
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Building2 className="size-4" />
            <span className="text-sm">{po.supplier_name || 'No Supplier'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar className="size-4" />
            <span className="text-sm">
              {po.created_at
                ? format(parseISO(po.created_at), 'MMM d, yyyy')
                : 'N/A'}
            </span>
          </span>
        </div>
      )}
      actions={(
        <div className="flex items-center gap-2 shrink-0">
          {canApprove && (
            <Button onClick={onApprove} disabled={approvePending}>
              {approvePending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Check className="size-4 mr-2" />
              )}
              Approve
            </Button>
          )}
          {canSend && (
            <Button onClick={onOpenSendDialog}>
              <Send className="size-4 mr-2" />
              Send to Supplier
            </Button>
          )}
          {canReceive && (
            <Button onClick={onCreateGRN}>
              <Plus className="size-4 mr-2" />
              Create GRN
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
              <DropdownMenuItem>
                <Download className="size-4 mr-2" />
                Export PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRefresh}>
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
        onClick={onBack}
      >
        <ArrowLeft className="size-4 mr-2" />
        Back to Purchase Orders
      </Button>
    </PageHeader>
  );
}

function ReceivingProgressCard({ canReceive, totalReceived, totalOrdered, receivedProgress }) {
  if (!canReceive) {
    return null;
  }

  return (
    <Card className="bg-card/30 border-border/50">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Receiving Progress</span>
          <span className="text-sm font-mono">
            {formatNumber(totalReceived)} / {formatNumber(totalOrdered)} items
          </span>
        </div>
        <Progress value={receivedProgress} className="h-2" />
      </CardContent>
    </Card>
  );
}

function getPurchaseOrderItemKey(item) {
  return item.id || item.item_id || item.sku || `${item.item_name || item.name}-${item.quantity}-${item.unit_price}`;
}

function PurchaseOrderItemsCard({ items, totalAmount }) {
  return (
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
                  Ordered
                </th>
                <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Received
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
              {items.map((item) => {
                const itemReceived = item.received_quantity || 0;
                const itemOrdered = item.quantity || 0;
                const isComplete = itemReceived >= itemOrdered;
                const isPartial = itemReceived > 0 && itemReceived < itemOrdered;

                return (
                  <tr key={getPurchaseOrderItemKey(item)} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">{item.item_name || item.name}</p>
                          {item.sku && (
                            <p className="text-xs font-mono text-muted-foreground">{item.sku}</p>
                          )}
                        </div>
                        {isComplete && (
                          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                            Complete
                          </Badge>
                        )}
                        {isPartial && (
                          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/30">
                            Partial
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {formatNumber(itemOrdered)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      <span className={cn(
                        isComplete && 'text-emerald-500',
                        isPartial && 'text-amber-500'
                      )}>
                        {formatNumber(itemReceived)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {formatCurrency(item.unit_price)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                      {formatCurrency((item.quantity || 0) * (item.unit_price || 0))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/50 border-t border-border">
              <tr>
                <td colSpan="4" className="px-4 py-3 text-right text-sm font-medium">
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
  );
}

function RelatedGRNsCard({ grns, onOpenGRN }) {
  if (grns.length === 0) {
    return null;
  }

  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Goods Received Notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {grns.map((grn) => (
          <button
            type="button"
            key={grn.id || grn.grn_number}
            className="flex w-full items-center justify-between p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => onOpenGRN(grn.id)}
          >
            <div className="flex items-center gap-3">
              <Package className="size-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-mono">{grn.grn_number || `GRN-${grn.id}`}</p>
                <p className="text-xs text-muted-foreground">
                  {grn.received_date
                    ? format(parseISO(grn.received_date), 'MMM d, yyyy')
                    : 'N/A'}
                </p>
              </div>
            </div>
            <Badge variant="outline" className="text-xs">
              {grn.status}
            </Badge>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function PurchaseOrderNotesCard({ notes }) {
  if (!notes) {
    return null;
  }

  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {notes}
        </p>
      </CardContent>
    </Card>
  );
}

function PurchaseOrderMainColumn({ po, summary, onOpenGRN }) {
  return (
    <div className="lg:col-span-2 space-y-6">
      <PurchaseOrderItemsCard items={summary.items} totalAmount={summary.totalAmount} />
      <RelatedGRNsCard grns={summary.grns} onOpenGRN={onOpenGRN} />
      <PurchaseOrderNotesCard notes={po.notes} />
    </div>
  );
}

function SupplierCard({ po }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Supplier</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <Building2 className="size-4 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{po.supplier_name || 'N/A'}</p>
            {po.supplier_code && (
              <p className="text-xs font-mono text-muted-foreground">{po.supplier_code}</p>
            )}
          </div>
        </div>

        {po.supplier_contact && (
          <div className="flex items-start gap-3">
            <Phone className="size-4 mt-0.5 text-muted-foreground" />
            <p className="text-sm">{po.supplier_contact}</p>
          </div>
        )}

        {po.supplier_email && (
          <div className="flex items-start gap-3">
            <Mail className="size-4 mt-0.5 text-muted-foreground" />
            <p className="text-sm">{po.supplier_email}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PurchaseOrderDetailsCard({ po, onOpenRequisition }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {po.expected_delivery_date && (
          <div className="flex items-start gap-3">
            <Calendar className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Expected Delivery</p>
              <p className="text-sm font-mono">
                {format(parseISO(po.expected_delivery_date), 'MMM d, yyyy')}
              </p>
            </div>
          </div>
        )}

        {po.requisition_number && (
          <div className="flex items-start gap-3">
            <FileText className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">From Requisition</p>
              <Button
                variant="link"
                className="p-0 h-auto text-sm"
                onClick={() => onOpenRequisition(po.requisition)}
              >
                {po.requisition_number}
              </Button>
            </div>
          </div>
        )}

        {po.approved_by_name && (
          <div className="flex items-start gap-3">
            <Check className="size-4 mt-0.5 text-emerald-500" />
            <div>
              <p className="text-xs text-muted-foreground">Approved By</p>
              <p className="text-sm">{po.approved_by_name}</p>
              {po.approved_at && (
                <p className="text-xs font-mono text-muted-foreground">
                  {format(parseISO(po.approved_at), 'MMM d, yyyy HH:mm')}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityEvent({ color, label, timestamp }) {
  return (
    <div className="flex items-start gap-3">
      <div className={cn('size-2 rounded-full mt-2', color)} />
      <div>
        <p className="text-sm">{label}</p>
        <p className="text-xs font-mono text-muted-foreground">
          {format(parseISO(timestamp), 'MMM d, yyyy HH:mm')}
        </p>
      </div>
    </div>
  );
}

function PurchaseOrderActivityCard({ po }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {po.created_at && (
            <ActivityEvent color="bg-sky-500" label="Created" timestamp={po.created_at} />
          )}
          {po.approved_at && (
            <ActivityEvent color="bg-emerald-500" label="Approved" timestamp={po.approved_at} />
          )}
          {po.sent_at && (
            <ActivityEvent color="bg-sky-500" label="Sent to Supplier" timestamp={po.sent_at} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PurchaseOrderSidebar({ po, onOpenRequisition }) {
  return (
    <div className="space-y-6">
      <SupplierCard po={po} />
      <PurchaseOrderDetailsCard po={po} onOpenRequisition={onOpenRequisition} />
      <PurchaseOrderActivityCard po={po} />
    </div>
  );
}

function SendPurchaseOrderDialog({
  isOpen,
  po,
  items,
  totalAmount,
  isSending,
  onOpenChange,
  onSend,
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send to Supplier</DialogTitle>
          <DialogDescription>
            This will mark the purchase order as sent and notify the supplier.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Supplier</span>
              <span>{po.supplier_name}</span>
            </div>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSend} disabled={isSending}>
            {isSending ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Send className="size-4 mr-2" />
            )}
            Send to Supplier
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * PurchaseOrderDetailPage - PO detail with receiving workflow
 */
export default function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const { data: po, isLoading, error, refetch } = usePurchaseOrder(id);
  const approveMutation = useApprovePurchaseOrder();
  const sendMutation = useSendPurchaseOrder();

  const handleBack = useCallback(() => {
    navigate('/inventory/purchase-orders');
  }, [navigate]);
  const handleApprove = useCallback(async () => {
    try {
      await approveMutation.mutateAsync(id);
      toast.success('Purchase order approved');
    } catch (error) {
      toast.error(error.message || 'Failed to approve purchase order');
    }
  }, [approveMutation, id]);
  const handleSend = useCallback(async () => {
    try {
      await sendMutation.mutateAsync(id);
      toast.success('Purchase order sent to supplier');
      setSendDialogOpen(false);
    } catch (error) {
      toast.error(error.message || 'Failed to send purchase order');
    }
  }, [id, sendMutation]);
  const handleCreateGRN = useCallback(() => {
    navigate(`/inventory/grns?action=create&po=${id}`);
  }, [id, navigate]);
  const handleOpenGRN = useCallback((grnId) => {
    navigate(`/inventory/grns/${grnId}`);
  }, [navigate]);
  const handleOpenRequisition = useCallback((requisitionId) => {
    navigate(`/inventory/requisitions/${requisitionId}`);
  }, [navigate]);
  const handleOpenSendDialog = useCallback(() => {
    setSendDialogOpen(true);
  }, []);
  const summary = useMemo(() => (po ? buildPurchaseOrderSummary(po) : null), [po]);

  if (isLoading) {
    return <PurchaseOrderLoadingState />;
  }

  if (error) {
    return (
      <PurchaseOrderErrorState
        error={error}
        onBack={handleBack}
        onRetry={refetch}
      />
    );
  }

  if (!po || !summary) {
    return <PurchaseOrderEmptyState onBack={handleBack} />;
  }

  const statusConfig = getStatusConfig(po.status);

  return (
    <PageShell>
      <PurchaseOrderHeader
        po={po}
        id={id}
        statusConfig={statusConfig}
        canApprove={summary.canApprove}
        canSend={summary.canSend}
        canReceive={summary.canReceive}
        approvePending={approveMutation.isPending}
        onBack={handleBack}
        onApprove={handleApprove}
        onOpenSendDialog={handleOpenSendDialog}
        onCreateGRN={handleCreateGRN}
        onRefresh={refetch}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <ReceivingProgressCard
          canReceive={summary.canReceive}
          totalReceived={summary.totalReceived}
          totalOrdered={summary.totalOrdered}
          receivedProgress={summary.receivedProgress}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <PurchaseOrderMainColumn
            po={po}
            summary={summary}
            onOpenGRN={handleOpenGRN}
          />
          <PurchaseOrderSidebar
            po={po}
            onOpenRequisition={handleOpenRequisition}
          />
        </div>

        <SendPurchaseOrderDialog
          isOpen={sendDialogOpen}
          po={po}
          items={summary.items}
          totalAmount={summary.totalAmount}
          isSending={sendMutation.isPending}
          onOpenChange={setSendDialogOpen}
          onSend={handleSend}
        />
      </div>
    </PageShell>
  );
}
