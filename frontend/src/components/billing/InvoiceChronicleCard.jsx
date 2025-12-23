import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate } from 'react-router-dom';
import { usePatientInvoices } from '@/hooks/useBillingQueries';
import { useAuth } from '@/lib/auth';
import {
  FileText,
  CreditCard,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
} from 'lucide-react';

/**
 * InvoiceChronicleCard - Billing summary card for patient chronicle
 *
 * Shows:
 * - Outstanding balance
 * - Number of pending invoices
 * - Quick actions to view invoices or record payment
 */
export default function InvoiceChronicleCard({ patientId, className }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: invoicesData, isLoading, error } = usePatientInvoices(patientId);

  const invoices = invoicesData?.results || invoicesData || [];
  const userRole = user?.role || user?.user_type;
  const canManageBilling = ['admin', 'billing'].includes(userRole);

  // Calculate summary
  const summary = invoices.reduce(
    (acc, invoice) => {
      if (invoice.status === 'pending' || invoice.status === 'partially_paid' || invoice.status === 'overdue') {
        acc.outstanding += invoice.balance_due || 0;
        acc.pendingCount += 1;
        if (invoice.status === 'overdue') {
          acc.overdueCount += 1;
        }
      }
      acc.total += invoice.total_amount || 0;
      return acc;
    },
    { outstanding: 0, pendingCount: 0, overdueCount: 0, total: 0 }
  );

  if (isLoading) {
    return (
      <div className={cn("bg-card border border-border rounded-xl p-4", className)}>
        <Skeleton className="h-6 w-32 mb-3" />
        <Skeleton className="h-8 w-24 mb-2" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }

  if (error) {
    return null; // Silently fail - billing info is optional
  }

  // Don't show if no invoices
  if (invoices.length === 0) {
    return (
      <div className={cn(
        "bg-card/50 border border-border rounded-xl p-4",
        className
      )}>
        <div className="flex items-center gap-2 mb-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
            Billing
          </span>
        </div>
        <p className="text-sm text-muted-foreground">No billing history</p>
      </div>
    );
  }

  const hasOutstanding = summary.outstanding > 0;
  const hasOverdue = summary.overdueCount > 0;

  return (
    <div className={cn(
      "bg-card border rounded-xl p-4 transition-colors",
      hasOverdue ? "border-destructive/50" : hasOutstanding ? "border-primary/30" : "border-border",
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CreditCard className={cn(
            "h-4 w-4",
            hasOverdue ? "text-destructive" : hasOutstanding ? "text-primary" : "text-muted-foreground"
          )} />
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
            Billing
          </span>
        </div>
        {hasOverdue && (
          <span className="badge-chronicle-rose text-[10px] flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Overdue
          </span>
        )}
        {!hasOverdue && hasOutstanding && (
          <span className="badge-chronicle-amber text-[10px] flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </span>
        )}
        {!hasOutstanding && (
          <span className="badge-chronicle-emerald text-[10px] flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            Settled
          </span>
        )}
      </div>

      {/* Outstanding Amount */}
      {hasOutstanding ? (
        <div className="mb-3">
          <p className="font-mono text-xs text-muted-foreground mb-1">Outstanding Balance</p>
          <p className={cn(
            "font-display text-2xl tracking-tight",
            hasOverdue ? "text-destructive" : "text-primary"
          )}>
            {formatCurrency(summary.outstanding)}
          </p>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            {summary.pendingCount} invoice{summary.pendingCount !== 1 ? 's' : ''} pending
            {summary.overdueCount > 0 && (
              <span className="text-destructive">
                {' '}({summary.overdueCount} overdue)
              </span>
            )}
          </p>
        </div>
      ) : (
        <div className="mb-3">
          <p className="font-mono text-xs text-muted-foreground mb-1">Total Billed</p>
          <p className="font-display text-2xl tracking-tight text-[oklch(0.70_0.17_155)]">
            {formatCurrency(summary.total)}
          </p>
          <p className="font-mono text-xs text-muted-foreground mt-1">
            All invoices settled
          </p>
        </div>
      )}

      {/* Recent Invoices Preview - prioritize unpaid, exclude drafts */}
      {invoices.length > 0 && (() => {
        // Filter out drafts and cancelled - they shouldn't be shown
        const visibleInvoices = invoices.filter(
          inv => inv.status !== 'draft' && inv.status !== 'cancelled'
        );

        // Separate unpaid vs paid
        const unpaidStatuses = ['pending', 'partially_paid', 'overdue'];
        const unpaidInvoices = visibleInvoices.filter(inv => unpaidStatuses.includes(inv.status));
        const paidInvoices = visibleInvoices.filter(inv => inv.status === 'paid');

        // Show up to 2: prioritize unpaid, fill with paid if needed
        const previewInvoices = [
          ...unpaidInvoices.slice(0, 2),
          ...paidInvoices.slice(0, Math.max(0, 2 - unpaidInvoices.length))
        ].slice(0, 2);

        if (previewInvoices.length === 0) return null;

        return (
          <div className="space-y-2 mb-3">
            {previewInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className={cn(
                  "flex items-center justify-between text-sm rounded-lg p-2 -mx-2 transition-colors",
                  canManageBilling ? "cursor-pointer hover:bg-muted/30" : "cursor-default"
                )}
                onClick={() => {
                  if (canManageBilling) {
                    navigate(`/billing/invoices/${invoice.id}`);
                  }
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="font-mono text-xs text-primary truncate">
                    {invoice.invoice_number}
                  </span>
                  <StatusBadge status={invoice.status} />
                </div>
                <span className="font-mono text-xs text-foreground">
                  {formatCurrency(invoice.status === 'paid' ? invoice.total_amount : invoice.balance_due)}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Actions */}
      {canManageBilling && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/billing/invoices?patient=${patientId}`)}
            className="flex-1 font-mono text-xs"
          >
            View All
            <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
          {hasOutstanding && (
            <Button
              size="sm"
              onClick={() => navigate(`/billing/invoices/${invoices.find(i => i.balance_due > 0)?.id}`)}
              className="font-mono text-xs"
            >
              <DollarSign className="h-3 w-3 mr-1" />
              Pay
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const statusMap = {
    draft: { class: 'bg-muted text-muted-foreground', label: 'Draft' },
    pending: { class: 'bg-primary/10 text-primary', label: 'Due' },
    partially_paid: { class: 'bg-[oklch(0.70_0.15_230_/_0.1)] text-[oklch(0.70_0.15_230)]', label: 'Partial' },
    paid: { class: 'bg-[oklch(0.70_0.17_155_/_0.1)] text-[oklch(0.70_0.17_155)]', label: 'Paid' },
    overdue: { class: 'bg-destructive/10 text-destructive', label: 'Overdue' },
    cancelled: { class: 'bg-muted text-muted-foreground', label: 'Void' },
  };

  const badge = statusMap[status] || { class: 'bg-muted text-muted-foreground', label: status };

  return (
    <span className={cn("text-[9px] px-1.5 py-0.5 rounded uppercase", badge.class)}>
      {badge.label}
    </span>
  );
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}
