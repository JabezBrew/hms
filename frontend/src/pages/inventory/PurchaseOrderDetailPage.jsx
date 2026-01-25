import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
} from '@/hooks/useInventoryQueries';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import Download from 'lucide-react/dist/esm/icons/download.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';

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
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
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

  const handleBack = () => {
    navigate('/inventory/purchase-orders');
  };

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync(id);
      toast.success('Purchase order approved');
    } catch (error) {
      toast.error(error.message || 'Failed to approve purchase order');
    }
  };

  const handleSend = async () => {
    try {
      await sendMutation.mutateAsync(id);
      toast.success('Purchase order sent to supplier');
      setSendDialogOpen(false);
    } catch (error) {
      toast.error(error.message || 'Failed to send purchase order');
    }
  };

  const handleCreateGRN = () => {
    navigate(`/inventory/grns?action=create&po=${id}`);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
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
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl">Error Loading Purchase Order</h2>
          <p className="text-muted-foreground">{error.message}</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Purchase Orders
            </Button>
            <Button onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Not found
  if (!po) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <FileText className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="font-display text-2xl">Purchase Order Not Found</h2>
          <p className="text-muted-foreground">
            The requested purchase order does not exist or has been deleted.
          </p>
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Purchase Orders
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = getStatusConfig(po.status);
  const items = po.items || po.purchase_order_items || [];
  const totalAmount = po.total_amount || items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unit_price || 0), 0);

  // Calculate received progress
  const totalOrdered = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const totalReceived = items.reduce((sum, item) => sum + (item.received_quantity || 0), 0);
  const receivedProgress = totalOrdered > 0 ? (totalReceived / totalOrdered) * 100 : 0;

  const canApprove = po.status === 'pending';
  const canSend = po.status === 'approved';
  const canReceive = ['sent', 'acknowledged', 'receiving', 'partially_received'].includes(po.status);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit -ml-2"
          onClick={handleBack}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Purchase Orders
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="font-display text-3xl font-semibold">
                {po.po_number || `PO-${id}`}
              </h1>
              <Badge className={cn('text-xs', statusConfig.bgColor, statusConfig.color)}>
                {statusConfig.label}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                <span className="text-sm">{po.supplier_name || 'No Supplier'}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                <span className="text-sm">
                  {po.created_at
                    ? format(parseISO(po.created_at), 'MMM d, yyyy')
                    : 'N/A'}
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {canApprove && (
              <Button onClick={handleApprove} disabled={approveMutation.isPending}>
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Approve
              </Button>
            )}
            {canSend && (
              <Button onClick={() => setSendDialogOpen(true)}>
                <Send className="h-4 w-4 mr-2" />
                Send to Supplier
              </Button>
            )}
            {canReceive && (
              <Button onClick={handleCreateGRN}>
                <Plus className="h-4 w-4 mr-2" />
                Create GRN
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Download className="h-4 w-4 mr-2" />
                  Export PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Receiving Progress */}
      {canReceive && (
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
                    {items.map((item, index) => {
                      const itemReceived = item.received_quantity || 0;
                      const itemOrdered = item.quantity || 0;
                      const isComplete = itemReceived >= itemOrdered;
                      const isPartial = itemReceived > 0 && itemReceived < itemOrdered;

                      return (
                        <tr key={item.id || index} className="hover:bg-muted/30 transition-colors">
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

          {/* Related GRNs */}
          {(po.grns || po.goods_received_notes || []).length > 0 && (
            <Card className="bg-card/30 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Goods Received Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(po.grns || po.goods_received_notes || []).map((grn, index) => (
                  <div
                    key={grn.id || index}
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/inventory/grns/${grn.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 text-muted-foreground" />
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
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {po.notes && (
            <Card className="bg-card/30 border-border/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {po.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Supplier Card */}
          <Card className="bg-card/30 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Supplier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3">
                <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{po.supplier_name || 'N/A'}</p>
                  {po.supplier_code && (
                    <p className="text-xs font-mono text-muted-foreground">{po.supplier_code}</p>
                  )}
                </div>
              </div>

              {po.supplier_contact && (
                <div className="flex items-start gap-3">
                  <Phone className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <p className="text-sm">{po.supplier_contact}</p>
                </div>
              )}

              {po.supplier_email && (
                <div className="flex items-start gap-3">
                  <Mail className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <p className="text-sm">{po.supplier_email}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Details Card */}
          <Card className="bg-card/30 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {po.expected_delivery_date && (
                <div className="flex items-start gap-3">
                  <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
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
                  <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">From Requisition</p>
                    <Button
                      variant="link"
                      className="p-0 h-auto text-sm"
                      onClick={() => navigate(`/inventory/requisitions/${po.requisition}`)}
                    >
                      {po.requisition_number}
                    </Button>
                  </div>
                </div>
              )}

              {po.approved_by_name && (
                <div className="flex items-start gap-3">
                  <Check className="h-4 w-4 mt-0.5 text-emerald-500" />
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

          {/* Activity Timeline */}
          <Card className="bg-card/30 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {po.created_at && (
                  <div className="flex items-start gap-3">
                    <div className="h-2 w-2 rounded-full bg-sky-500 mt-2" />
                    <div>
                      <p className="text-sm">Created</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {format(parseISO(po.created_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                )}
                {po.approved_at && (
                  <div className="flex items-start gap-3">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 mt-2" />
                    <div>
                      <p className="text-sm">Approved</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {format(parseISO(po.approved_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                )}
                {po.sent_at && (
                  <div className="flex items-start gap-3">
                    <div className="h-2 w-2 rounded-full bg-sky-500 mt-2" />
                    <div>
                      <p className="text-sm">Sent to Supplier</p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {format(parseISO(po.sent_at), 'MMM d, yyyy HH:mm')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Send Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
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
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sendMutation.isPending}>
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send to Supplier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
