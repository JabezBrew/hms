import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js';
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Building from 'lucide-react/dist/esm/icons/building.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import Mail from 'lucide-react/dist/esm/icons/mail.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { useNavigate, useParams } from 'react-router-dom';
import { useInvoice, useGenerateClaim } from '@/features/billing/hooks';
import { useReceiptPrint } from '@/hooks/useReceiptPrint';
import { toast } from 'sonner';

import RecordPaymentSlideOver from '@/components/billing/RecordPaymentSlideOver';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

const STATUS_BADGES = {
  draft: { class: 'bg-muted text-muted-foreground', label: 'Draft', icon: Clock },
  pending: { class: 'badge-chronicle-amber', label: 'Pending Payment', icon: Clock },
  partially_paid: { class: 'badge-chronicle-sky', label: 'Partially Paid', icon: DollarSign },
  paid: { class: 'badge-chronicle-emerald', label: 'Paid', icon: CheckCircle },
  overdue: { class: 'badge-chronicle-rose', label: 'Overdue', icon: AlertTriangle },
  cancelled: { class: 'bg-muted text-muted-foreground', label: 'Cancelled', icon: Clock },
};

function getStatusBadge(status) {
  return STATUS_BADGES[status] || { class: 'bg-muted text-muted-foreground', label: status, icon: Clock };
}

function getPatientBillingDetails(invoice) {
  return {
    name: invoice.patient_name ||
      (invoice.patient_details?.user_details
        ? `${invoice.patient_details.user_details.first_name} ${invoice.patient_details.user_details.last_name}`
        : 'Unknown Patient'),
    mrn: invoice.patient_mrn || invoice.patient_details?.medical_record_number,
    phone: invoice.patient_phone || invoice.patient_details?.user_details?.phone_number,
    email: invoice.patient_email || invoice.patient_details?.user_details?.email,
  };
}

function getFacilityDetails(invoice) {
  return {
    name: invoice.facility_name || invoice.facility_details?.name,
    code: invoice.facility_code || invoice.facility_details?.code,
  };
}

function InvoiceLoadingState() {
  return (
    <PageState variant="loading">
      <div className="flex items-center gap-4">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-8 w-48" />
      </div>
      <Skeleton className="h-48 rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </PageState>
  );
}

function InvoiceErrorState({ error, onBack, onRetry }) {
  return (
    <PageState
      variant="error"
      title="Error Loading Invoice"
      description={error.message}
      action={(
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={onBack} className="font-mono text-xs">
            <ArrowLeft className="size-4 mr-2" />
            Back to Invoices
          </Button>
          <Button onClick={onRetry} className="font-mono text-xs">
            <RefreshCw className="size-4 mr-2" />
            Retry
          </Button>
        </div>
      )}
    />
  );
}

function InvoiceHeader({
  invoice,
  badge,
  isGeneratingClaim,
  isPrintingInvoice,
  onBack,
  onRecordPayment,
  onGenerateClaim,
  onPrint,
}) {
  const StatusIcon = badge.icon;

  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <FileText className="size-6 text-primary" />
          {invoice.invoice_number}
          <span className={cn("text-xs px-2 py-1 rounded flex items-center gap-1", badge.class)}>
            <StatusIcon className="size-3" />
            {badge.label}
          </span>
        </span>
      )}
      description={(
        <span className="text-muted-foreground">
          Created {formatDate(invoice.created_at)}
          {invoice.due_date && ` · Due ${formatDate(invoice.due_date)}`}
        </span>
      )}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
            <Button onClick={onRecordPayment} className="font-mono text-xs">
              <CreditCard className="size-4 mr-2" />
              Record Payment
            </Button>
          )}
          {invoice.status !== 'cancelled' && !invoice.has_claim && invoice.insurance_amount > 0 && (
            <Button
              variant="outline"
              onClick={onGenerateClaim}
              disabled={isGeneratingClaim}
              className="font-mono text-xs"
            >
              <FileSpreadsheet className="size-4 mr-2" />
              Generate Claim
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onPrint}
            disabled={isPrintingInvoice}
            className="font-mono text-xs"
          >
            {isPrintingInvoice ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <Printer className="size-4 mr-2" />
                Print Invoice
              </>
            )}
          </Button>
        </div>
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="font-mono text-xs w-fit -ml-2"
      >
        <ArrowLeft className="size-4 mr-2" />
        Back to Invoices
      </Button>
    </PageHeader>
  );
}

function PatientBillingSection({ invoice, patient, onOpenPatient }) {
  return (
    <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
      <h2 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
        <User className="size-5 text-muted-foreground" />
        Patient Information
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Patient Name
          </p>
          <button
            type="button"
            className="text-left text-foreground font-medium cursor-pointer hover:text-primary transition-colors"
            onClick={() => onOpenPatient(invoice.patient)}
          >
            {patient.name}
          </button>
        </div>
        {patient.mrn && (
          <div>
            <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">
              MRN
            </p>
            <p className="font-mono text-foreground">{patient.mrn}</p>
          </div>
        )}
        {patient.phone && (
          <div className="flex items-center gap-2">
            <Phone className="size-4 text-muted-foreground" />
            <p className="font-mono text-sm text-foreground">{patient.phone}</p>
          </div>
        )}
        {patient.email && (
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground" />
            <p className="font-mono text-sm text-foreground">{patient.email}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function InvoiceItemsSection({ invoice }) {
  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <header className="px-5 sm:px-6 py-4 border-b border-border">
        <h2 className="font-display text-lg text-foreground">Invoice Items</h2>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-5 sm:px-6 py-3 text-left font-mono text-xs text-muted-foreground uppercase tracking-wider">
                Description
              </th>
              <th className="px-4 py-3 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                Qty
              </th>
              <th className="px-4 py-3 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                Unit Price
              </th>
              <th className="px-5 sm:px-6 py-3 text-right font-mono text-xs text-muted-foreground uppercase tracking-wider">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoice.items?.map((item, index) => (
              <tr key={item.id || index} className="hover:bg-muted/20">
                <td className="px-5 sm:px-6 py-4">
                  <p className="text-foreground">{item.description || item.service_name}</p>
                  {item.service_code && (
                    <p className="font-mono text-xs text-muted-foreground">{item.service_code}</p>
                  )}
                </td>
                <td className="p-4 text-right font-mono text-sm text-foreground">
                  {item.quantity}
                </td>
                <td className="p-4 text-right font-mono text-sm text-foreground">
                  {formatCurrency(item.unit_price)}
                </td>
                <td className="px-5 sm:px-6 py-4 text-right font-mono text-sm text-foreground">
                  {formatCurrency(item.total_price || item.quantity * item.unit_price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InvoiceTotals invoice={invoice} />
    </section>
  );
}

function InvoiceTotals({ invoice }) {
  return (
    <div className="px-5 sm:px-6 py-4 border-t border-border bg-muted/20">
      <div className="flex flex-col gap-2 max-w-xs ml-auto">
        <div className="flex justify-between">
          <span className="font-mono text-sm text-muted-foreground">Subtotal</span>
          <span className="font-mono text-sm text-foreground">
            {formatCurrency(invoice.subtotal || invoice.total_amount)}
          </span>
        </div>
        {invoice.tax_amount > 0 && (
          <div className="flex justify-between">
            <span className="font-mono text-sm text-muted-foreground">Tax</span>
            <span className="font-mono text-sm text-foreground">
              {formatCurrency(invoice.tax_amount)}
            </span>
          </div>
        )}
        {invoice.discount_amount > 0 && (
          <div className="flex justify-between">
            <span className="font-mono text-sm text-muted-foreground">Discount</span>
            <span className="font-mono text-sm text-[oklch(0.70_0.17_155)]">
              -{formatCurrency(invoice.discount_amount)}
            </span>
          </div>
        )}
        {invoice.insurance_coverage > 0 && (
          <div className="flex justify-between">
            <span className="font-mono text-sm text-muted-foreground">Insurance</span>
            <span className="font-mono text-sm text-[oklch(0.70_0.15_230)]">
              -{formatCurrency(invoice.insurance_coverage)}
            </span>
          </div>
        )}
        <div className="flex justify-between pt-2 border-t border-border">
          <span className="font-mono text-sm font-medium text-foreground">Total</span>
          <span className="font-mono text-lg font-medium text-foreground">
            {formatCurrency(invoice.total_amount)}
          </span>
        </div>
        {invoice.amount_paid > 0 && (
          <div className="flex justify-between">
            <span className="font-mono text-sm text-muted-foreground">Paid</span>
            <span className="font-mono text-sm text-[oklch(0.70_0.17_155)]">
              -{formatCurrency(invoice.amount_paid)}
            </span>
          </div>
        )}
        <div className="flex justify-between pt-2 border-t border-border">
          <span className="font-mono text-sm font-medium text-foreground">Balance Due</span>
          <span className={cn(
            "font-mono text-lg font-medium",
            invoice.balance_due > 0 ? "text-primary" : "text-[oklch(0.70_0.17_155)]"
          )}>
            {formatCurrency(invoice.balance_due)}
          </span>
        </div>
      </div>
    </div>
  );
}

function PaymentHistorySection({ payments, printingId, onPrintReceipt }) {
  if (!payments?.length) {
    return null;
  }

  return (
    <section className="bg-card border border-border rounded-2xl overflow-hidden">
      <header className="px-5 sm:px-6 py-4 border-b border-border">
        <h2 className="font-display text-lg text-foreground flex items-center gap-2">
          <CreditCard className="size-5 text-[oklch(0.70_0.17_155)]" />
          Payment History
        </h2>
      </header>
      <div className="divide-y divide-border">
        {payments.map((payment, index) => (
          <div key={payment.id || index} className="px-5 sm:px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-foreground">{formatDate(payment.payment_date)}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {formatPaymentMethod(payment.payment_method)}
                  {payment.reference_number && ` · Ref: ${payment.reference_number}`}
                </p>
              </div>
              <span className="font-mono text-lg text-[oklch(0.70_0.17_155)]">
                +{formatCurrency(payment.amount)}
              </span>
            </div>
            {payment.receipt_number && (
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="font-mono text-xs text-muted-foreground">
                    Receipt: {payment.receipt_number}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPrintReceipt(payment)}
                  disabled={printingId === payment.id}
                  className="font-mono text-xs h-7 px-2"
                >
                  {printingId === payment.id ? (
                    <>
                      <Loader2 className="size-3 mr-1 animate-spin" />
                      Loading…
                    </>
                  ) : (
                    <>
                      <Printer className="size-3 mr-1" />
                      Print Receipt
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function InvoiceSidebar({ invoice, badge, facility, onOpenEncounter }) {
  return (
    <div className="space-y-6">
      <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
        <h2 className="font-display text-lg text-foreground mb-4">Summary</h2>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status</span>
            <span className={cn("text-xs px-2 py-1 rounded", badge.class)}>
              {badge.label}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Total Amount</span>
            <span className="font-mono text-foreground">{formatCurrency(invoice.total_amount)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Amount Paid</span>
            <span className="font-mono text-[oklch(0.70_0.17_155)]">{formatCurrency(invoice.amount_paid)}</span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-border">
            <span className="font-medium text-foreground">Balance Due</span>
            <span className="font-mono text-lg font-medium text-primary">
              {formatCurrency(invoice.balance_due)}
            </span>
          </div>
        </div>
      </section>

      {facility.name && (
        <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
          <h2 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
            <Building className="size-5 text-muted-foreground" />
            Facility
          </h2>
          <p className="text-foreground">{facility.name}</p>
          {facility.code && (
            <p className="font-mono text-xs text-muted-foreground">{facility.code}</p>
          )}
        </section>
      )}

      {invoice.encounter && (
        <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
          <h2 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
            <Calendar className="size-5 text-muted-foreground" />
            Related Encounter
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenEncounter(invoice.encounter)}
            className="font-mono text-xs w-full"
          >
            View Encounter
          </Button>
        </section>
      )}

      {invoice.notes && (
        <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
          <h2 className="font-display text-lg text-foreground mb-4">Notes</h2>
          <p className="text-sm text-muted-foreground">{invoice.notes}</p>
        </section>
      )}
    </div>
  );
}

function InvoiceDetailContent({
  invoice,
  badge,
  patient,
  facility,
  printingId,
  onOpenPatient,
  onOpenEncounter,
  onPrintReceipt,
}) {
  return (
    <main className="p-4 sm:p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <PatientBillingSection
            invoice={invoice}
            patient={patient}
            onOpenPatient={onOpenPatient}
          />
          <InvoiceItemsSection invoice={invoice} />
          <PaymentHistorySection
            payments={invoice.payments}
            printingId={printingId}
            onPrintReceipt={onPrintReceipt}
          />
        </div>

        <InvoiceSidebar
          invoice={invoice}
          badge={badge}
          facility={facility}
          onOpenEncounter={onOpenEncounter}
        />
      </div>
    </main>
  );
}

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showPaymentSlideOver, setShowPaymentSlideOver] = useState(false);

  const {
    data: invoice,
    isLoading,
    error,
    refetch,
  } = useInvoice(id);

  const generateClaimMutation = useGenerateClaim();

  // Receipt and invoice printing hook
  const { printReceipt, printInvoice, printingId } = useReceiptPrint();

  const handleGenerateClaim = async () => {
    try {
      await generateClaimMutation.mutateAsync(id);
      toast.success('Insurance claim generated successfully');
    } catch (err) {
      toast.error(err.message || 'Failed to generate claim');
    }
  };

  const handlePrint = () => {
    printInvoice(id);
  };

  // Loading state
  if (isLoading) {
    return <InvoiceLoadingState />;
  }

  // Error state
  if (error) {
    return (
      <InvoiceErrorState
        error={error}
        onBack={() => navigate('/billing/invoices')}
        onRetry={refetch}
      />
    );
  }

  const badge = getStatusBadge(invoice.status);
  const patient = getPatientBillingDetails(invoice);
  const facility = getFacilityDetails(invoice);

  return (
    <PageShell>
      <InvoiceHeader
        invoice={invoice}
        badge={badge}
        isGeneratingClaim={generateClaimMutation.isPending}
        isPrintingInvoice={printingId === id}
        onBack={() => navigate('/billing/invoices')}
        onRecordPayment={() => setShowPaymentSlideOver(true)}
        onGenerateClaim={handleGenerateClaim}
        onPrint={handlePrint}
      />

      <InvoiceDetailContent
        invoice={invoice}
        badge={badge}
        patient={patient}
        facility={facility}
        printingId={printingId}
        onOpenPatient={(patientId) => navigate(`/patients/${patientId}`)}
        onOpenEncounter={(encounterId) => navigate(`/encounters/${encounterId}`)}
        onPrintReceipt={printReceipt}
      />

      {/* Record Payment Slide-Over */}
      <RecordPaymentSlideOver
        open={showPaymentSlideOver}
        onClose={() => setShowPaymentSlideOver(false)}
        invoice={invoice}
        onRefreshInvoice={refetch}
      />
    </PageShell>
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
    year: 'numeric',
  });
}

function formatPaymentMethod(method) {
  const methods = {
    cash: 'Cash',
    credit_card: 'Credit Card',
    debit_card: 'Debit Card',
    mobile_money: 'Mobile Money',
    bank_transfer: 'Bank Transfer',
    insurance: 'Insurance',
  };
  return methods[method] || method;
}
