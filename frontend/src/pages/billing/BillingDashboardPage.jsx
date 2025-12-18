import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate } from 'react-router-dom';
import {
  useBillingDashboardMetrics,
  useRecentInvoices,
  useRecentPayments,
} from '@/hooks/useBillingQueries';
import {
  DollarSign,
  FileText,
  Receipt,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  Clock,
  CreditCard,
  TrendingUp,
  Users,
  Calendar,
  Plus,
  FileSpreadsheet,
} from 'lucide-react';

export default function BillingDashboardPage() {
  const navigate = useNavigate();

  // Fetch dashboard data
  const {
    data: metrics,
    isLoading: metricsLoading,
    error: metricsError,
    refetch: refetchMetrics,
  } = useBillingDashboardMetrics();

  const {
    data: recentInvoices,
    isLoading: invoicesLoading,
  } = useRecentInvoices({ limit: 5 });

  const {
    data: recentPayments,
    isLoading: paymentsLoading,
  } = useRecentPayments({ limit: 5 });

  const isLoading = metricsLoading || invoicesLoading || paymentsLoading;

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      </div>
    );
  }

  // Error state
  if (metricsError) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl text-foreground">Error Loading Dashboard</h2>
          <p className="text-muted-foreground">{metricsError.message}</p>
          <Button onClick={() => refetchMetrics()} className="font-mono text-xs">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2">
              {todayDate}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl text-foreground tracking-tight">
              Billing Dashboard
            </h1>
            <p className="text-muted-foreground mt-2">
              Revenue tracking and invoice management
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/billing/invoices/new')}
              className="font-mono text-xs"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Invoice
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchMetrics()}
              className="font-mono text-xs"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 space-y-6">
        {/* Metrics Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Revenue Today"
            value={formatCurrency(metrics?.revenue_today || 0)}
            icon={DollarSign}
            color="amber"
            index={0}
          />
          <MetricCard
            title="This Week"
            value={formatCurrency(metrics?.revenue_this_week || 0)}
            icon={TrendingUp}
            color="emerald"
            index={1}
          />
          <MetricCard
            title="Outstanding"
            value={formatCurrency(metrics?.outstanding_amount || 0)}
            subtitle={`${metrics?.outstanding_invoices || 0} invoices`}
            icon={FileText}
            color="rose"
            index={2}
          />
          <MetricCard
            title="Pending Claims"
            value={metrics?.pending_claims || 0}
            subtitle={formatCurrency(metrics?.pending_claims_amount || 0)}
            icon={FileSpreadsheet}
            color="sky"
            index={3}
          />
        </section>

        {/* Quick Stats Row */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <QuickStat
            label="Invoices Today"
            value={metrics?.invoices_created_today || 0}
            icon={FileText}
          />
          <QuickStat
            label="Payments Today"
            value={metrics?.payments_received_today || 0}
            icon={CreditCard}
          />
          <QuickStat
            label="Patients Billed"
            value={metrics?.unique_patients_billed || 0}
            icon={Users}
          />
          <QuickStat
            label="Avg Invoice"
            value={formatCurrency(metrics?.average_invoice_amount || 0)}
            icon={Receipt}
          />
        </section>

        {/* Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Invoices */}
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <header className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary" />
                <h2 className="font-display text-xl text-foreground">Recent Invoices</h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/billing/invoices')}
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                View All
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </header>
            <div className="divide-y divide-border">
              {recentInvoices && recentInvoices.length > 0 ? (
                recentInvoices.map((invoice, index) => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    index={index}
                    onClick={() => navigate(`/billing/invoices/${invoice.id}`)}
                  />
                ))
              ) : (
                <EmptyState icon={FileText} message="No recent invoices" />
              )}
            </div>
          </section>

          {/* Recent Payments */}
          <section className="bg-card border border-border rounded-2xl overflow-hidden">
            <header className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-[oklch(0.70_0.17_155)]" />
                <h2 className="font-display text-xl text-foreground">Recent Payments</h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/billing/payments')}
                className="font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                View All
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </header>
            <div className="divide-y divide-border">
              {recentPayments && recentPayments.length > 0 ? (
                recentPayments.map((payment, index) => (
                  <PaymentRow
                    key={payment.id}
                    payment={payment}
                    index={index}
                  />
                ))
              ) : (
                <EmptyState icon={CreditCard} message="No recent payments" />
              )}
            </div>
          </section>
        </div>

        {/* Quick Actions */}
        <section className="bg-card/50 border border-border rounded-2xl p-6">
          <h2 className="font-display text-xl text-foreground mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <QuickActionButton
              icon={Plus}
              label="Create Invoice"
              onClick={() => navigate('/billing/invoices/new')}
            />
            <QuickActionButton
              icon={FileSpreadsheet}
              label="View Claims"
              onClick={() => navigate('/billing/claims')}
            />
            <QuickActionButton
              icon={Receipt}
              label="Payment History"
              onClick={() => navigate('/billing/payments')}
            />
            <QuickActionButton
              icon={Calendar}
              label="Reports"
              onClick={() => navigate('/billing/reports')}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

// Helper Components
function MetricCard({ title, value, subtitle, icon: Icon, color, index }) {
  const colorClasses = {
    amber: 'bg-primary/10 text-primary',
    emerald: 'bg-[oklch(0.70_0.17_155_/_0.1)] text-[oklch(0.70_0.17_155)]',
    rose: 'bg-destructive/10 text-destructive',
    sky: 'bg-[oklch(0.70_0.15_230_/_0.1)] text-[oklch(0.70_0.15_230)]',
  };

  return (
    <article
      className={cn(
        "relative bg-card border border-border rounded-2xl p-5",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn("p-2.5 rounded-xl", colorClasses[color])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">
        {title}
      </p>
      <p className="font-display text-2xl sm:text-3xl text-foreground tracking-tight">
        {value}
      </p>
      {subtitle && (
        <p className="font-mono text-xs text-muted-foreground mt-1">{subtitle}</p>
      )}
    </article>
  );
}

function QuickStat({ label, value, icon: Icon }) {
  return (
    <div className="bg-card/50 border border-border rounded-xl p-4 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="font-mono text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-lg text-foreground">{value}</p>
      </div>
    </div>
  );
}

function InvoiceRow({ invoice, index, onClick }) {
  const getStatusBadge = (status) => {
    const statusMap = {
      draft: { class: 'bg-muted text-muted-foreground', label: 'Draft' },
      pending: { class: 'badge-chronicle-amber', label: 'Pending' },
      partially_paid: { class: 'badge-chronicle-sky', label: 'Partial' },
      paid: { class: 'badge-chronicle-emerald', label: 'Paid' },
      overdue: { class: 'badge-chronicle-rose', label: 'Overdue' },
      cancelled: { class: 'bg-muted text-muted-foreground', label: 'Cancelled' },
    };
    return statusMap[status] || { class: 'bg-muted text-muted-foreground', label: status };
  };

  const badge = getStatusBadge(invoice.status);

  return (
    <article
      className={cn(
        "px-6 py-4 hover:bg-muted/30 cursor-pointer transition-colors",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${(index + 4) * 50}ms` }}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-primary">
              {invoice.invoice_number}
            </span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded", badge.class)}>
              {badge.label}
            </span>
          </div>
          <p className="text-sm text-foreground truncate">{invoice.patient_name}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {formatDate(invoice.created_at)}
          </p>
        </div>
        <div className="text-right pl-4">
          <p className="font-mono text-sm text-foreground">
            {formatCurrency(invoice.total_amount)}
          </p>
          {invoice.balance_due > 0 && invoice.balance_due !== invoice.total_amount && (
            <p className="font-mono text-xs text-muted-foreground">
              Due: {formatCurrency(invoice.balance_due)}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function PaymentRow({ payment, index }) {
  return (
    <article
      className={cn(
        "px-6 py-4 animate-chronicle-enter"
      )}
      style={{ animationDelay: `${(index + 4) * 50}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground truncate">{payment.patient_name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-xs text-muted-foreground">
              {formatDate(payment.payment_date)}
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {formatPaymentMethod(payment.payment_method)}
            </span>
          </div>
        </div>
        <div className="text-right pl-4">
          <p className="font-mono text-sm text-[oklch(0.70_0.17_155)]">
            +{formatCurrency(payment.amount)}
          </p>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function QuickActionButton({ icon: Icon, label, onClick }) {
  return (
    <Button
      variant="outline"
      className="h-auto py-4 flex flex-col items-center gap-2 font-mono text-xs hover:border-primary/30"
      onClick={onClick}
    >
      <Icon className="h-5 w-5" />
      {label}
    </Button>
  );
}

// Utility functions
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

function formatDate(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPaymentMethod(method) {
  const methods = {
    cash: 'Cash',
    card: 'Card',
    mobile_money: 'MoMo',
    bank_transfer: 'Bank',
    insurance: 'Insurance',
  };
  return methods[method] || method;
}
