import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useGRN,
  useUpdateGRNItem,
  useInspectGRN,
  useAcceptGRN,
} from '@/features/inventory/hooks';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import AlertOctagon from 'lucide-react/dist/esm/icons/alert-octagon.js';
import Pencil from 'lucide-react/dist/esm/icons/pencil.js';

const US_NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

const STATUS_CONFIG = {
  draft: { label: 'Draft', color: 'text-slate-500', bgColor: 'bg-slate-500/10' },
  pending_inspection: { label: 'Pending Inspection', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  inspecting: { label: 'Inspecting', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  accepted: { label: 'Accepted', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  partially_accepted: { label: 'Partially Accepted', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  rejected: { label: 'Rejected', color: 'text-rose-500', bgColor: 'bg-rose-500/10' },
};

function getStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || { label: status || 'Unknown', color: 'text-muted-foreground', bgColor: 'bg-muted' };
}

function formatNumber(value) {
  return US_NUMBER_FORMATTER.format(value || 0);
}

/**
 * GRNItemRow - Editable row for GRN item with batch entry
 */
function GRNItemRow({
  item,
  grnId,
  canEdit,
  onUpdate,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    received_quantity: item.received_quantity || item.quantity || 0,
    batch_number: item.batch_number || '',
    expiry_date: item.expiry_date || '',
    accepted_quantity: item.accepted_quantity || item.received_quantity || item.quantity || 0,
    rejection_reason: item.rejection_reason || '',
    item_status: item.item_status || 'pending',
  });

  const updateMutation = useUpdateGRNItem();

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({
        grnId,
        itemId: item.id,
        data: editData,
      });
      toast.success('Item updated');
      setIsEditing(false);
      onUpdate?.();
    } catch (error) {
      toast.error(error.message || 'Failed to update item');
    }
  };

  const orderedQty = item.ordered_quantity || item.quantity || 0;
  const receivedQty = item.received_quantity || 0;
  const acceptedQty = item.accepted_quantity || 0;
  const hasDiscrepancy = receivedQty !== orderedQty;
  const hasRejection = acceptedQty < receivedQty;

  if (isEditing) {
    return (
      <tr className="bg-sky-500/5">
        <td className="px-4 py-3">
          <div>
            <p className="text-sm font-medium">{item.item_name || item.name}</p>
            {item.sku && (
              <p className="text-xs font-mono text-muted-foreground">{item.sku}</p>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm">
          {formatNumber(orderedQty)}
        </td>
        <td className="px-4 py-3">
          <Input
            type="number"
            min="0"
            value={editData.received_quantity}
            onChange={(e) => setEditData({ ...editData, received_quantity: parseInt(e.target.value) || 0 })}
            className="w-20 font-mono text-sm"
          />
        </td>
        <td className="px-4 py-3">
          <Input
            placeholder="Batch #"
            value={editData.batch_number}
            onChange={(e) => setEditData({ ...editData, batch_number: e.target.value })}
            className="w-28 font-mono text-sm"
          />
        </td>
        <td className="px-4 py-3">
          <Input
            type="date"
            value={editData.expiry_date}
            onChange={(e) => setEditData({ ...editData, expiry_date: e.target.value })}
            className="w-36 font-mono text-sm"
          />
        </td>
        <td className="px-4 py-3">
          <Select
            value={editData.item_status}
            onValueChange={(value) => setEditData({ ...editData, item_status: value })}
          >
            <SelectTrigger className="w-32 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="accepted">Accept</SelectItem>
              <SelectItem value="rejected">Reject</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
            </SelectContent>
          </Select>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="size-8 p-0"
              onClick={handleSave}
              disabled={updateMutation.isPending}
              aria-label={`Save ${item.item_name || item.name || 'GRN item'}`}
            >
              {updateMutation.isPending ? (
                <LoadingSpinner className="size-4" />
              ) : (
                <Check className="size-4 text-emerald-500" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="size-8 p-0"
              onClick={() => setIsEditing(false)}
              aria-label={`Cancel editing ${item.item_name || item.name || 'GRN item'}`}
            >
              <X className="size-4 text-muted-foreground" />
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className={cn(
      'hover:bg-muted/30 transition-colors',
      hasDiscrepancy && 'bg-amber-500/5',
      hasRejection && 'bg-rose-500/5'
    )}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div>
            <p className="text-sm font-medium">{item.item_name || item.name}</p>
            {item.sku && (
              <p className="text-xs font-mono text-muted-foreground">{item.sku}</p>
            )}
          </div>
          {hasDiscrepancy && (
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/30">
              Discrepancy
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm">
        {formatNumber(orderedQty)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm">
        <span className={cn(hasDiscrepancy && 'text-amber-500')}>
          {formatNumber(receivedQty)}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-sm">
        {item.batch_number || <span className="text-muted-foreground">-</span>}
      </td>
      <td className="px-4 py-3 font-mono text-sm">
        {item.expiry_date ? (
          format(parseISO(item.expiry_date), 'MMM d, yyyy')
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        {item.item_status === 'accepted' && (
          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
            Accepted
          </Badge>
        )}
        {item.item_status === 'rejected' && (
          <Badge variant="outline" className="text-xs bg-rose-500/10 text-rose-500 border-rose-500/30">
            Rejected
          </Badge>
        )}
        {item.item_status === 'partial' && (
          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/30">
            Partial
          </Badge>
        )}
        {(!item.item_status || item.item_status === 'pending') && (
          <Badge variant="outline" className="text-xs">
            Pending
          </Badge>
        )}
      </td>
      <td className="px-4 py-3">
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            className="size-8 p-0"
            onClick={() => setIsEditing(true)}
            aria-label={`Edit ${item.item_name || item.name || 'GRN item'}`}
          >
            <Pencil className="size-4 text-muted-foreground" />
          </Button>
        )}
      </td>
    </tr>
  );
}

function calculateGRNStats(grn, items) {
  const totalOrdered = items.reduce((sum, item) => sum + (item.ordered_quantity || item.quantity || 0), 0);
  const totalReceived = items.reduce((sum, item) => sum + (item.received_quantity || 0), 0);
  const totalAccepted = items.reduce((sum, item) => sum + (item.accepted_quantity || 0), 0);

  return {
    totalOrdered,
    totalReceived,
    totalAccepted,
    acceptedProgress: totalReceived > 0 ? (totalAccepted / totalReceived) * 100 : 0,
    hasQualityIssues: grn.has_quality_issues || items.some(
      (item) => item.item_status === 'rejected' || item.rejection_reason
    ),
  };
}

function GRNDetailLoadingState() {
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
        </div>
        <Skeleton className="h-80" />
      </div>
    </PageState>
  );
}

function GRNDetailErrorState({ error, onBack, onRetry }) {
  return (
    <PageState
      variant="error"
      title="Error Loading GRN"
      description={error.message}
      action={(
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="size-4 mr-2" />
            Back to GRNs
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

function GRNNotFoundState({ onBack }) {
  return (
    <PageState
      variant="empty"
      title="GRN Not Found"
      description="The requested GRN does not exist or has been deleted."
      action={(
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="size-4 mr-2" />
          Back to GRNs
        </Button>
      )}
    />
  );
}

function GRNDetailHeader({
  grn,
  grnId,
  statusConfig,
  hasQualityIssues,
  canInspect,
  canAccept,
  inspectPending,
  onBack,
  onRefresh,
  onStartInspection,
  onOpenAcceptDialog,
}) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <span>{grn.grn_number || `GRN-${grnId}`}</span>
          <Badge className={cn('text-xs', statusConfig.bgColor, statusConfig.color)}>
            {statusConfig.label}
          </Badge>
          {hasQualityIssues && (
            <Badge variant="destructive" className="text-xs">
              <AlertOctagon className="size-3 mr-1" />
              Quality Issues
            </Badge>
          )}
        </span>
      )}
      description={(
        <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Building2 className="size-4" />
            <span className="text-sm">{grn.supplier_name || 'Unknown Supplier'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar className="size-4" />
            <span className="text-sm">
              {grn.received_date
                ? format(parseISO(grn.received_date), 'MMM d, yyyy')
                : 'N/A'}
            </span>
          </span>
        </div>
      )}
      actions={(
        <div className="flex items-center gap-2 shrink-0">
          {canInspect && (
            <Button onClick={onStartInspection} disabled={inspectPending}>
              {inspectPending ? (
                <LoadingSpinner className="size-4 mr-2" />
              ) : (
                <ClipboardCheck className="size-4 mr-2" />
              )}
              Start Inspection
            </Button>
          )}
          {canAccept && (
            <Button onClick={onOpenAcceptDialog}>
              <Check className="size-4 mr-2" />
              Accept & Update Stock
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="GRN actions">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <Printer className="size-4 mr-2" />
                Print
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
        Back to GRNs
      </Button>
    </PageHeader>
  );
}

function RustV2GRNItemNotice({ canEditItems, status, itemCount }) {
  if (canEditItems || !['pending_inspection', 'inspecting'].includes(status) || itemCount === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      GRN item editing is not available in Rust V2 mode yet. Inspection and acceptance remain
      available through generated /api/v2 contracts.
    </div>
  );
}

function AcceptanceProgressCard({ status, totalAccepted, totalReceived, acceptedProgress }) {
  if (status !== 'inspecting') {
    return null;
  }

  return (
    <Card className="bg-card/30 border-border/50">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Acceptance Progress</span>
          <span className="text-sm font-mono">
            {formatNumber(totalAccepted)} / {formatNumber(totalReceived)} accepted
          </span>
        </div>
        <Progress value={acceptedProgress} className="h-2" />
      </CardContent>
    </Card>
  );
}

function GRNItemsCard({ items, grnId, canEdit, onUpdate }) {
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
                <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Batch
                </th>
                <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Expiry
                </th>
                <th className="text-center px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th aria-label="Item actions" className="text-center px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item, index) => (
                <GRNItemRow
                  key={item.id || index}
                  item={item}
                  grnId={grnId}
                  canEdit={canEdit}
                  onUpdate={onUpdate}
                />
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function QualityIssuesCard({ items, hasQualityIssues }) {
  if (!hasQualityIssues) {
    return null;
  }

  return (
    <Card className="bg-rose-500/5 border-rose-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-rose-500 flex items-center gap-2">
          <AlertOctagon className="size-4" />
          Quality Issues
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.reduce((qualityIssueRows, item, index) => {
            if (item.rejection_reason || item.item_status === 'rejected') {
              qualityIssueRows.push(
                <div key={item.id || index} className="p-3 bg-rose-500/10 rounded-lg">
                  <p className="text-sm font-medium">{item.item_name || item.name}</p>
                  {item.rejection_reason && (
                    <p className="text-sm text-muted-foreground mt-1">{item.rejection_reason}</p>
                  )}
                </div>,
              );
            }
            return qualityIssueRows;
          }, [])}
        </div>
      </CardContent>
    </Card>
  );
}

function GRNNotesCard({ notes }) {
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

function GRNDetailsCard({ grn, onOpenPurchaseOrder }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {grn.po_number && (
          <div className="flex items-start gap-3">
            <FileText className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Purchase Order</p>
              <Button
                variant="link"
                className="p-0 h-auto text-sm"
                onClick={() => onOpenPurchaseOrder(grn.purchase_order)}
              >
                {grn.po_number}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3">
          <Building2 className="size-4 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Supplier</p>
            <p className="text-sm">{grn.supplier_name || 'N/A'}</p>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <User className="size-4 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-xs text-muted-foreground">Received By</p>
            <p className="text-sm">{grn.received_by_name || grn.created_by_name || 'N/A'}</p>
          </div>
        </div>

        {grn.inspected_by_name && (
          <div className="flex items-start gap-3">
            <ClipboardCheck className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Inspected By</p>
              <p className="text-sm">{grn.inspected_by_name}</p>
              {grn.inspected_at && (
                <p className="text-xs font-mono text-muted-foreground">
                  {format(parseISO(grn.inspected_at), 'MMM d, yyyy HH:mm')}
                </p>
              )}
            </div>
          </div>
        )}

        {grn.delivery_note_number && (
          <div className="flex items-start gap-3">
            <FileText className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Delivery Note</p>
              <p className="text-sm font-mono">{grn.delivery_note_number}</p>
            </div>
          </div>
        )}

        {grn.invoice_number && (
          <div className="flex items-start gap-3">
            <FileText className="size-4 mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Invoice</p>
              <p className="text-sm font-mono">{grn.invoice_number}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GRNSummaryCard({ status, totalOrdered, totalReceived, totalAccepted }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total Ordered</span>
          <span className="font-mono">{formatNumber(totalOrdered)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total Received</span>
          <span className={cn('font-mono', totalReceived !== totalOrdered && 'text-amber-500')}>
            {formatNumber(totalReceived)}
          </span>
        </div>
        {status === 'accepted' || status === 'partially_accepted' ? (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total Accepted</span>
            <span className="font-mono text-emerald-500">{formatNumber(totalAccepted)}</span>
          </div>
        ) : null}
        {totalReceived !== totalOrdered && (
          <div className="flex justify-between text-sm pt-2 border-t border-border">
            <span className="text-muted-foreground">Discrepancy</span>
            <span className={cn('font-mono', totalReceived > totalOrdered ? 'text-sky-500' : 'text-rose-500')}>
              {totalReceived > totalOrdered ? '+' : ''}{formatNumber(totalReceived - totalOrdered)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GRNActivityCard({ grn }) {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {grn.created_at && (
            <div className="flex items-start gap-3">
              <div className="size-2 rounded-full bg-sky-500 mt-2" />
              <div>
                <p className="text-sm">Created</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {format(parseISO(grn.created_at), 'MMM d, yyyy HH:mm')}
                </p>
              </div>
            </div>
          )}
          {grn.inspection_started_at && (
            <div className="flex items-start gap-3">
              <div className="size-2 rounded-full bg-amber-500 mt-2" />
              <div>
                <p className="text-sm">Inspection Started</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {format(parseISO(grn.inspection_started_at), 'MMM d, yyyy HH:mm')}
                </p>
              </div>
            </div>
          )}
          {grn.accepted_at && (
            <div className="flex items-start gap-3">
              <div className="size-2 rounded-full bg-emerald-500 mt-2" />
              <div>
                <p className="text-sm">Accepted</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {format(parseISO(grn.accepted_at), 'MMM d, yyyy HH:mm')}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AcceptGRNDialog({
  open,
  items,
  totalReceived,
  totalAccepted,
  hasQualityIssues,
  acceptPending,
  onOpenChange,
  onAccept,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Accept GRN & Update Stock</DialogTitle>
          <DialogDescription>
            This will accept the GRN and create stock entries for all accepted items.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Items</span>
              <span className="font-mono">{items.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Received</span>
              <span className="font-mono">{formatNumber(totalReceived)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">To Be Accepted</span>
              <span className="font-mono font-semibold text-emerald-500">
                {formatNumber(totalAccepted)}
              </span>
            </div>
          </div>
          {hasQualityIssues && (
            <div className="mt-4 p-3 bg-amber-500/10 rounded-lg flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-500 mt-0.5" />
              <p className="text-sm text-amber-500">
                This GRN has quality issues. Only accepted items will be added to stock.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onAccept} disabled={acceptPending}>
            {acceptPending ? (
              <LoadingSpinner className="size-4 mr-2" />
            ) : (
              <Check className="size-4 mr-2" />
            )}
            Accept & Update Stock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * GRNDetailPage - GRN detail with batch entry and inspection
 */
export default function GRNDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const grnItemEditingAvailable = !isRustV2ApiMode();
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);
  const { data: grn, isLoading, error, refetch } = useGRN(id);
  const inspectMutation = useInspectGRN();
  const acceptMutation = useAcceptGRN();

  const handleBack = () => {
    navigate('/inventory/grns');
  };

  const handleStartInspection = async () => {
    try {
      await inspectMutation.mutateAsync(id);
      toast.success('Inspection started');
    } catch (error) {
      toast.error(error.message || 'Failed to start inspection');
    }
  };

  const handleAccept = async () => {
    try {
      await acceptMutation.mutateAsync(id);
      toast.success('GRN accepted - stock updated');
      setAcceptDialogOpen(false);
    } catch (error) {
      toast.error(error.message || 'Failed to accept GRN');
    }
  };

  if (isLoading) {
    return <GRNDetailLoadingState />;
  }

  if (error) {
    return <GRNDetailErrorState error={error} onBack={handleBack} onRetry={refetch} />;
  }

  if (!grn) {
    return <GRNNotFoundState onBack={handleBack} />;
  }

  const statusConfig = getStatusConfig(grn.status);
  const items = grn.items || grn.grn_items || [];
  const {
    totalOrdered,
    totalReceived,
    totalAccepted,
    acceptedProgress,
    hasQualityIssues,
  } = calculateGRNStats(grn, items);
  const canInspect = grn.status === 'pending_inspection';
  const canEdit = grnItemEditingAvailable && ['pending_inspection', 'inspecting'].includes(grn.status);
  const canAccept = grn.status === 'inspecting';
  const handleOpenPurchaseOrder = (purchaseOrderId) => {
    navigate(`/inventory/purchase-orders/${purchaseOrderId}`);
  };

  return (
    <PageShell>
      <GRNDetailHeader
        grn={grn}
        grnId={id}
        statusConfig={statusConfig}
        hasQualityIssues={hasQualityIssues}
        canInspect={canInspect}
        canAccept={canAccept}
        inspectPending={inspectMutation.isPending}
        onBack={handleBack}
        onRefresh={refetch}
        onStartInspection={handleStartInspection}
        onOpenAcceptDialog={() => setAcceptDialogOpen(true)}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <RustV2GRNItemNotice
          canEditItems={grnItemEditingAvailable}
          status={grn.status}
          itemCount={items.length}
        />

        <AcceptanceProgressCard
          status={grn.status}
          totalAccepted={totalAccepted}
          totalReceived={totalReceived}
          acceptedProgress={acceptedProgress}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <GRNItemsCard
              items={items}
              grnId={id}
              canEdit={canEdit}
              onUpdate={refetch}
            />

            <QualityIssuesCard items={items} hasQualityIssues={hasQualityIssues} />

            <GRNNotesCard notes={grn.notes} />
          </div>

          <div className="space-y-6">
            <GRNDetailsCard grn={grn} onOpenPurchaseOrder={handleOpenPurchaseOrder} />

            <GRNSummaryCard
              status={grn.status}
              totalOrdered={totalOrdered}
              totalReceived={totalReceived}
              totalAccepted={totalAccepted}
            />

            <GRNActivityCard grn={grn} />
          </div>
        </div>

        <AcceptGRNDialog
          open={acceptDialogOpen}
          items={items}
          totalReceived={totalReceived}
          totalAccepted={totalAccepted}
          hasQualityIssues={hasQualityIssues}
          acceptPending={acceptMutation.isPending}
          onOpenChange={setAcceptDialogOpen}
          onAccept={handleAccept}
        />
      </div>
    </PageShell>
  );
}
