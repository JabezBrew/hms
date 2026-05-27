import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Receipt from 'lucide-react/dist/esm/icons/receipt.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Layers from 'lucide-react/dist/esm/icons/layers.js';
import Link2 from 'lucide-react/dist/esm/icons/link-2.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useBillingDashboardMetrics,
  useRecentInvoices,
  useRecentPayments,
  useActiveFacilityBillingSettings,
  useCurrentCashSession,
  useCashSessionTotals,
  useOpenCashSession,
  useCloseCashSession,
} from '@/features/billing/hooks';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

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

  // Cash controls (optional)
  const { data: settingsRows } = useActiveFacilityBillingSettings();
  const billingSettings = Array.isArray(settingsRows) ? settingsRows[0] : null;
  const cashControlEnabled = !!billingSettings?.cash_control_enabled;
  const { data: currentSessionData } = useCurrentCashSession({ enabled: cashControlEnabled });
  const currentSession = currentSessionData?.session || null;
  const { data: currentTotalsData } = useCashSessionTotals(currentSession?.id, { enabled: !!currentSession?.id });
  const openCashSessionMutation = useOpenCashSession();
  const closeCashSessionMutation = useCloseCashSession();
  const [openingFloat, setOpeningFloat] = useState('0.00');
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [countedCash, setCountedCash] = useState('');

  const isLoading = metricsLoading || invoicesLoading || paymentsLoading;

  const handleOpenCashSession = async () => {
    try {
      await openCashSessionMutation.mutateAsync({
        opening_float_amount: parseFloat(openingFloat || 0),
      });
      toast.success('Cash session opened');
    } catch (err) {
      toast.error(err.message || 'Failed to open cash session');
    }
  };

  const handlePrepareCloseSession = () => {
    setCountedCash('');
    setCloseDialogOpen(true);
  };

  const handleCloseCashSession = async () => {
    if (!currentSession) return;
    try {
      await closeCashSessionMutation.mutateAsync({
        sessionId: currentSession.id,
        data: { counted_cash_amount: parseFloat(countedCash || 0) },
      });
      toast.success('Session closed');
      setCloseDialogOpen(false);
    } catch (err) {
      toast.error(err.message || 'Failed to close session');
    }
  };

  if (isLoading) {
    return <BillingDashboardLoading />;
  }

  if (metricsError) {
    return (
      <PageState
        variant="error"
        title="Error Loading Dashboard"
        description={metricsError.message}
        action={() => refetchMetrics()}
      />
    );
  }

  const todayDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <PageShell>
      <BillingDashboardHeader
        todayDate={todayDate}
        onCreateInvoice={() => navigate('/billing/invoices/new')}
        onRefresh={refetchMetrics}
      />

      <main className="p-4 sm:p-6 space-y-6">
        <MetricsSection metrics={metrics} />
        <QuickStatsSection metrics={metrics} />
        <CashSessionSection
          cashControlEnabled={cashControlEnabled}
          currentSession={currentSession}
          currentTotalsData={currentTotalsData}
          openingFloat={openingFloat}
          setOpeningFloat={setOpeningFloat}
          isOpening={openCashSessionMutation.isPending}
          isClosing={closeCashSessionMutation.isPending}
          onOpenSession={handleOpenCashSession}
          onPrepareCloseSession={handlePrepareCloseSession}
          onViewSessions={() => navigate('/billing/cash-sessions')}
        />
        <RecentActivitySection
          recentInvoices={recentInvoices}
          recentPayments={recentPayments}
          onViewInvoices={() => navigate('/billing/invoices')}
          onViewPayments={() => navigate('/billing/payments')}
          onOpenInvoice={(invoiceId) => navigate(`/billing/invoices/${invoiceId}`)}
        />
        <BillingQuickActions onNavigate={navigate} />
      </main>

      <CloseCashSessionDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        countedCash={countedCash}
        setCountedCash={setCountedCash}
        expectedCashAmount={currentTotalsData?.expected_cash_amount || 0}
        isClosing={closeCashSessionMutation.isPending}
        onCloseSession={handleCloseCashSession}
      />
    </PageShell>
  );
}

function BillingDashboardLoading() {
  return (
    <PageState variant="loading">
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
    </PageState>
  );
}

function BillingDashboardHeader({ todayDate, onCreateInvoice, onRefresh }) {
  return (
    <PageHeader
      title="Billing Dashboard"
      description="Revenue tracking and invoice management"
      meta={todayDate}
      actions={(
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCreateInvoice}
            className="font-mono text-xs"
          >
            <Plus className="size-4 mr-2" />
            New Invoice
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="font-mono text-xs"
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
        </div>
      )}
    />
  );
}

function MetricsSection({ metrics }) {
  return (
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
  );
}

function QuickStatsSection({ metrics }) {
  return (
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
  );
}

function CashSessionSection({
  cashControlEnabled,
  currentSession,
  currentTotalsData,
  openingFloat,
  setOpeningFloat,
  isOpening,
  isClosing,
  onOpenSession,
  onPrepareCloseSession,
  onViewSessions,
}) {
  const CashIcon = cashControlEnabled ? Clock : AlertTriangle;

  return (
    <section className="bg-card/50 border border-border rounded-2xl p-6">
      <header className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-muted">
            <CashIcon className={cn("size-5", cashControlEnabled ? "text-muted-foreground" : "text-destructive")} />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">Cash Session</h2>
            <p className="text-sm text-muted-foreground">
              {cashControlEnabled ? 'Cash controls are enabled for this facility.' : 'Cash controls are disabled for this facility.'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewSessions}
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          View Sessions
          <ChevronRight className="size-3 ml-1" />
        </Button>
      </header>

      {!cashControlEnabled ? (
        <CashSessionDisabledNotice />
      ) : currentSession ? (
        <ActiveCashSessionSummary
          currentSession={currentSession}
          expectedCashAmount={currentTotalsData?.expected_cash_amount || 0}
          isClosing={isClosing}
          onPrepareCloseSession={onPrepareCloseSession}
        />
      ) : (
        <OpenCashSessionForm
          openingFloat={openingFloat}
          setOpeningFloat={setOpeningFloat}
          isOpening={isOpening}
          onOpenSession={onOpenSession}
        />
      )}
    </section>
  );
}

function CashSessionDisabledNotice() {
  return (
    <div className="rounded-xl border border-border bg-muted/10 p-4">
      <p className="text-sm text-muted-foreground">
        Enable cash controls to require cashier sessions and compute close-of-day variance.
      </p>
    </div>
  );
}

function ActiveCashSessionSummary({
  currentSession,
  expectedCashAmount,
  isClosing,
  onPrepareCloseSession,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="rounded-xl bg-muted/20 border border-border/50 p-4">
        <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Opened At</p>
        <p className="font-mono text-sm text-foreground">{formatDate(currentSession.opened_at)}</p>
        <p className="font-mono text-xs text-muted-foreground mt-2">
          Float: {formatCurrency(currentSession.opening_float_amount)}
        </p>
      </div>
      <div className="rounded-xl bg-muted/20 border border-border/50 p-4">
        <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Expected Cash So Far</p>
        <p className="font-display text-2xl text-foreground">
          {formatCurrency(expectedCashAmount)}
        </p>
        <p className="font-mono text-xs text-muted-foreground mt-1">
          Includes float + movements + cash payments
        </p>
      </div>
      <div className="rounded-xl bg-muted/20 border border-border/50 p-4 flex flex-col justify-between">
        <div>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Closeout</p>
          <p className="text-sm text-foreground">
            Enter counted cash to close and record variance.
          </p>
        </div>
        <Button
          className="mt-4 font-mono text-xs"
          onClick={onPrepareCloseSession}
          disabled={isClosing}
        >
          Close Session
        </Button>
      </div>
    </div>
  );
}

function OpenCashSessionForm({
  openingFloat,
  setOpeningFloat,
  isOpening,
  onOpenSession,
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
      <div className="flex-1 space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider">Opening Float (GHS)</Label>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={openingFloat}
          onChange={(e) => setOpeningFloat(e.target.value)}
          className="font-mono"
        />
      </div>
      <Button
        className="font-mono text-xs"
        disabled={isOpening}
        onClick={onOpenSession}
      >
        {isOpening ? 'Opening…' : 'Open Session'}
      </Button>
    </div>
  );
}

function RecentActivitySection({
  recentInvoices,
  recentPayments,
  onViewInvoices,
  onViewPayments,
  onOpenInvoice,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <RecentInvoicesPanel
        recentInvoices={recentInvoices}
        onViewInvoices={onViewInvoices}
        onOpenInvoice={onOpenInvoice}
      />
      <RecentPaymentsPanel
        recentPayments={recentPayments}
        onViewPayments={onViewPayments}
      />
    </div>
  );
}

function RecentInvoicesPanel({ recentInvoices, onViewInvoices, onOpenInvoice }) {
  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <FileText className="size-5 text-primary" />
          <h2 className="font-display text-xl text-foreground">Recent Invoices</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewInvoices}
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          View All
          <ChevronRight className="size-3 ml-1" />
        </Button>
      </header>
      <div className="divide-y divide-border">
        {recentInvoices && recentInvoices.length > 0 ? (
          recentInvoices.map((invoice, index) => (
            <InvoiceRow
              key={invoice.id}
              invoice={invoice}
              index={index}
              onClick={() => onOpenInvoice(invoice.id)}
            />
          ))
        ) : (
          <EmptyState icon={FileText} message="No recent invoices" />
        )}
      </div>
    </section>
  );
}

function RecentPaymentsPanel({ recentPayments, onViewPayments }) {
  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <CreditCard className="size-5 text-[oklch(0.70_0.17_155)]" />
          <h2 className="font-display text-xl text-foreground">Recent Payments</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewPayments}
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          View All
          <ChevronRight className="size-3 ml-1" />
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
  );
}

function BillingQuickActions({ onNavigate }) {
  const actions = [
    { icon: Plus, label: 'Create Invoice', path: '/billing/invoices/new' },
    { icon: FileSpreadsheet, label: 'View Claims', path: '/billing/claims' },
    { icon: Receipt, label: 'Payment History', path: '/billing/payments' },
    { icon: CreditCard, label: 'PSP', path: '/billing/psp' },
    { icon: FileSpreadsheet, label: 'NHIS + AR', path: '/billing/nhis' },
    { icon: Shield, label: 'Insurance', path: '/billing/insurance' },
    { icon: Layers, label: 'Catalog', path: '/billing/catalog' },
    { icon: Link2, label: 'NHIS Mappings', path: '/billing/nhis/mappings' },
  ];

  return (
    <section className="bg-card/50 border border-border rounded-2xl p-6">
      <h2 className="font-display text-xl text-foreground mb-4">Quick Actions</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {actions.map((action) => (
          <QuickActionButton
            key={action.path}
            icon={action.icon}
            label={action.label}
            onClick={() => onNavigate(action.path)}
          />
        ))}
      </div>
    </section>
  );
}

function CloseCashSessionDialog({
  open,
  onOpenChange,
  countedCash,
  setCountedCash,
  expectedCashAmount,
  isClosing,
  onCloseSession,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close Cash Session</DialogTitle>
          <DialogDescription>
            Enter the counted cash amount to compute variance and close the session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="font-mono text-xs uppercase tracking-wider">Counted Cash (GHS)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={countedCash}
            onChange={(e) => setCountedCash(e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Expected so far: {formatCurrency(expectedCashAmount)}
          </p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-mono text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="font-mono text-xs"
            disabled={isClosing}
            onClick={onCloseSession}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricCard({ title, value, subtitle, icon: Icon, color, index }) {
  const colorClasses = {
    amber: 'bg-primary/10 text-primary',
    emerald: 'bg-[oklch(0.70_0.17_155_/_0.1)] text-[oklch(0.70_0.17_155)]',
    rose: 'bg-destructive/10 text-destructive',
    sky: 'bg-[oklch(0.70_0.15_230_/_0.1)] text-[oklch(0.70_0.15_230)]',
  };

  return (
    <div
      className={cn(
        "relative bg-card border border-border rounded-2xl p-5",
        "animate-chronicle-enter"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn("p-2.5 rounded-xl", colorClasses[color])}>
          <Icon className="size-5" />
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
    </div>
  );
}

function QuickStat({ label, value, icon: Icon }) {
  return (
    <div className="bg-card/50 border border-border rounded-xl p-4 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className="size-4 text-muted-foreground" />
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
    <button
      type="button"
      className={cn(
        "w-full px-6 py-4 text-left hover:bg-muted/30 cursor-pointer transition-colors",
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
    </button>
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
      <div className="size-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
        <Icon className="size-6 text-muted-foreground" />
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
      <Icon className="size-5" />
      {label}
    </Button>
  );
}

// Utility functions
function formatCurrency(amount) {
  return GHS_CURRENCY_FORMATTER.format(amount || 0);
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
    credit_card: 'Credit',
    debit_card: 'Debit',
    mobile_money: 'MoMo',
    bank_transfer: 'Bank',
    insurance: 'Insurance',
  };
  return methods[method] || method;
}
