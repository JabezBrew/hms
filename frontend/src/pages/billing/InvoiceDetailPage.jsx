import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate, useParams } from 'react-router-dom';
import { useInvoice, useGenerateClaim } from '@/hooks/useBillingQueries';
import { useReceiptPrint } from '@/hooks/useReceiptPrint';
import { toast } from 'sonner';
import {
  FileText,
  ArrowLeft,
  AlertTriangle,
  RefreshCw,
  CreditCard,
  FileSpreadsheet,
  Printer,
  Calendar,
  User,
  Building,
  Phone,
  Mail,
  CheckCircle,
  Clock,
  DollarSign,
  Loader2,
} from 'lucide-react';
import RecordPaymentSlideOver from '@/components/billing/RecordPaymentSlideOver';

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
    return (
      <div className="min-h-screen bg-background p-4 sm:p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="font-display text-2xl text-foreground">Error Loading Invoice</h2>
          <p className="text-muted-foreground">{error.message}</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => navigate('/billing/invoices')} className="font-mono text-xs">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Invoices
            </Button>
            <Button onClick={() => refetch()} className="font-mono text-xs">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status) => {
    const statusMap = {
      draft: { class: 'bg-muted text-muted-foreground', label: 'Draft', icon: Clock },
      pending: { class: 'badge-chronicle-amber', label: 'Pending Payment', icon: Clock },
      partially_paid: { class: 'badge-chronicle-sky', label: 'Partially Paid', icon: DollarSign },
      paid: { class: 'badge-chronicle-emerald', label: 'Paid', icon: CheckCircle },
      overdue: { class: 'badge-chronicle-rose', label: 'Overdue', icon: AlertTriangle },
      cancelled: { class: 'bg-muted text-muted-foreground', label: 'Cancelled', icon: Clock },
    };
    return statusMap[status] || { class: 'bg-muted text-muted-foreground', label: status, icon: Clock };
  };

  const badge = getStatusBadge(invoice.status);
  const StatusIcon = badge.icon;

  // Extract patient info from nested structure or flat fields
  const patientName = invoice.patient_name ||
    (invoice.patient_details?.user_details
      ? `${invoice.patient_details.user_details.first_name} ${invoice.patient_details.user_details.last_name}`
      : 'Unknown Patient');
  const patientMrn = invoice.patient_mrn || invoice.patient_details?.medical_record_number;
  const patientPhone = invoice.patient_phone || invoice.patient_details?.user_details?.phone_number;
  const patientEmail = invoice.patient_email || invoice.patient_details?.user_details?.email;

  // Extract facility info from nested structure or flat fields
  const facilityName = invoice.facility_name || invoice.facility_details?.name;
  const facilityCode = invoice.facility_code || invoice.facility_details?.code;

  return (
    <div className="min-h-screen bg-background">
      {/* Page Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col gap-4">
          {/* Back Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/billing/invoices')}
            className="font-mono text-xs w-fit -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Invoices
          </Button>

          {/* Invoice Title */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <FileText className="h-6 w-6 text-primary" />
                <h1 className="font-display text-2xl sm:text-3xl text-foreground tracking-tight">
                  {invoice.invoice_number}
                </h1>
                <span className={cn("text-xs px-2 py-1 rounded flex items-center gap-1", badge.class)}>
                  <StatusIcon className="h-3 w-3" />
                  {badge.label}
                </span>
              </div>
              <p className="text-muted-foreground">
                Created {formatDate(invoice.created_at)}
                {invoice.due_date && ` · Due ${formatDate(invoice.due_date)}`}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
                <Button
                  onClick={() => setShowPaymentSlideOver(true)}
                  className="font-mono text-xs"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  Record Payment
                </Button>
              )}
              {invoice.status !== 'cancelled' && !invoice.has_claim && invoice.insurance_amount > 0 && (
                <Button
                  variant="outline"
                  onClick={handleGenerateClaim}
                  disabled={generateClaimMutation.isPending}
                  className="font-mono text-xs"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Generate Claim
                </Button>
              )}
              <Button
                variant="outline"
                onClick={handlePrint}
                disabled={printingId === id}
                className="font-mono text-xs"
              >
                {printingId === id ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Printer className="h-4 w-4 mr-2" />
                    Print Invoice
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Patient Info */}
            <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
              <h2 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
                <User className="h-5 w-5 text-muted-foreground" />
                Patient Information
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">
                    Patient Name
                  </p>
                  <p
                    className="text-foreground font-medium cursor-pointer hover:text-primary transition-colors"
                    onClick={() => navigate(`/patients/${invoice.patient}`)}
                  >
                    {patientName}
                  </p>
                </div>
                {patientMrn && (
                  <div>
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">
                      MRN
                    </p>
                    <p className="font-mono text-foreground">{patientMrn}</p>
                  </div>
                )}
                {patientPhone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <p className="font-mono text-sm text-foreground">{patientPhone}</p>
                  </div>
                )}
                {patientEmail && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <p className="font-mono text-sm text-foreground">{patientEmail}</p>
                  </div>
                )}
              </div>
            </section>

            {/* Invoice Items */}
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
                        <td className="px-4 py-4 text-right font-mono text-sm text-foreground">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-4 text-right font-mono text-sm text-foreground">
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

              {/* Totals */}
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
            </section>

            {/* Payments */}
            {invoice.payments && invoice.payments.length > 0 && (
              <section className="bg-card border border-border rounded-2xl overflow-hidden">
                <header className="px-5 sm:px-6 py-4 border-b border-border">
                  <h2 className="font-display text-lg text-foreground flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-[oklch(0.70_0.17_155)]" />
                    Payment History
                  </h2>
                </header>
                <div className="divide-y divide-border">
                  {invoice.payments.map((payment, index) => (
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
                      {/* Receipt Info */}
                      {payment.receipt_number && (
                        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="font-mono text-xs text-muted-foreground">
                              Receipt: {payment.receipt_number}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => printReceipt(payment)}
                            disabled={printingId === payment.id}
                            className="font-mono text-xs h-7 px-2"
                          >
                            {printingId === payment.id ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                Loading...
                              </>
                            ) : (
                              <>
                                <Printer className="h-3 w-3 mr-1" />
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
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Summary Card */}
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

            {/* Facility Info */}
            {facilityName && (
              <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
                <h2 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
                  <Building className="h-5 w-5 text-muted-foreground" />
                  Facility
                </h2>
                <p className="text-foreground">{facilityName}</p>
                {facilityCode && (
                  <p className="font-mono text-xs text-muted-foreground">{facilityCode}</p>
                )}
              </section>
            )}

            {/* Encounter Info */}
            {invoice.encounter && (
              <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
                <h2 className="font-display text-lg text-foreground mb-4 flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  Related Encounter
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/encounters/${invoice.encounter}`)}
                  className="font-mono text-xs w-full"
                >
                  View Encounter
                </Button>
              </section>
            )}

            {/* Notes */}
            {invoice.notes && (
              <section className="bg-card border border-border rounded-2xl p-5 sm:p-6">
                <h2 className="font-display text-lg text-foreground mb-4">Notes</h2>
                <p className="text-sm text-muted-foreground">{invoice.notes}</p>
              </section>
            )}
          </div>
        </div>
      </main>

      {/* Record Payment Slide-Over */}
      <RecordPaymentSlideOver
        open={showPaymentSlideOver}
        onClose={() => setShowPaymentSlideOver(false)}
        invoice={invoice}
      />
    </div>
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
    year: 'numeric',
  });
}

function formatPaymentMethod(method) {
  const methods = {
    cash: 'Cash',
    card: 'Credit/Debit Card',
    mobile_money: 'Mobile Money',
    bank_transfer: 'Bank Transfer',
    insurance: 'Insurance',
  };
  return methods[method] || method;
}
