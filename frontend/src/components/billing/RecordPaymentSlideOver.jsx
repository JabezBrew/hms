import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X, CreditCard, Loader2, DollarSign, Receipt } from 'lucide-react';
import { useRecordPayment } from '@/hooks/useBillingQueries';
import { toast } from 'sonner';

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Credit/Debit Card' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'insurance', label: 'Insurance' },
];

/**
 * RecordPaymentSlideOver - Slide-over panel for recording invoice payments
 *
 * Features:
 * - Slides in from right without backdrop
 * - Payment amount with validation
 * - Payment method selection
 * - Optional reference number
 * - Optional receipt generation
 */
export default function RecordPaymentSlideOver({
  open,
  onClose,
  invoice,
}) {
  const recordPaymentMutation = useRecordPayment();

  // Form state
  const [formData, setFormData] = useState({
    amount: '',
    payment_method: 'cash',
    reference_number: '',
    notes: '',
  });
  const [generateReceipt, setGenerateReceipt] = useState(true);
  const [errors, setErrors] = useState({});

  // Reset form when panel opens/closes
  useEffect(() => {
    if (open && invoice) {
      setFormData({
        amount: invoice.balance_due?.toString() || '',
        payment_method: 'cash',
        reference_number: '',
        notes: '',
      });
      setGenerateReceipt(true);
      setErrors({});
    }
  }, [open, invoice]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      newErrors.amount = 'Please enter a valid amount';
    } else if (parseFloat(formData.amount) > (invoice?.balance_due || 0)) {
      newErrors.amount = 'Amount cannot exceed balance due';
    }

    if (!formData.payment_method) {
      newErrors.payment_method = 'Please select a payment method';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validate()) return;

    try {
      await recordPaymentMutation.mutateAsync({
        invoiceId: invoice.id,
        data: {
          amount: parseFloat(formData.amount),
          payment_method: formData.payment_method,
          reference_number: formData.reference_number || null,
          notes: formData.notes || null,
          generate_receipt: generateReceipt,
        },
      });

      toast.success('Payment recorded successfully');
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to record payment');
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GH', {
      style: 'currency',
      currency: 'GHS',
      minimumFractionDigits: 2,
    }).format(amount || 0);
  };

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full lg:w-[480px] bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[oklch(0.70_0.17_155_/_0.1)]">
            <CreditCard className="h-5 w-5 text-[oklch(0.70_0.17_155)]" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">Record Payment</h2>
            <p className="font-mono text-xs text-muted-foreground">
              {invoice?.invoice_number}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {/* Invoice Summary */}
        <div className="bg-muted/30 rounded-xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
              Invoice Summary
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Amount</span>
              <span className="font-mono text-sm text-foreground">
                {formatCurrency(invoice?.total_amount)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Amount Paid</span>
              <span className="font-mono text-sm text-[oklch(0.70_0.17_155)]">
                {formatCurrency(invoice?.amount_paid)}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border">
              <span className="text-sm font-medium text-foreground">Balance Due</span>
              <span className="font-mono text-lg font-medium text-primary">
                {formatCurrency(invoice?.balance_due)}
              </span>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Payment Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount" className="font-mono text-xs uppercase tracking-wider">
              Payment Amount <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm">
                GHS
              </span>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                max={invoice?.balance_due || 0}
                value={formData.amount}
                onChange={(e) => handleChange('amount', e.target.value)}
                className={cn(
                  'pl-12 font-mono',
                  errors.amount && 'border-destructive'
                )}
                placeholder="0.00"
              />
            </div>
            {errors.amount && (
              <p className="text-xs text-destructive">{errors.amount}</p>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleChange('amount', invoice?.balance_due?.toString() || '')}
                className="font-mono text-xs"
              >
                Full Amount
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleChange('amount', ((invoice?.balance_due || 0) / 2).toFixed(2))}
                className="font-mono text-xs"
              >
                50%
              </Button>
            </div>
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">
              Payment Method <span className="text-destructive">*</span>
            </Label>
            <Select
              value={formData.payment_method}
              onValueChange={(value) => handleChange('payment_method', value)}
            >
              <SelectTrigger className={cn(errors.payment_method && 'border-destructive')}>
                <SelectValue placeholder="Select method" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {PAYMENT_METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value} className="font-mono text-sm">
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.payment_method && (
              <p className="text-xs text-destructive">{errors.payment_method}</p>
            )}
          </div>

          {/* Reference Number */}
          <div className="space-y-2">
            <Label htmlFor="reference_number" className="font-mono text-xs uppercase tracking-wider">
              Reference Number
            </Label>
            <Input
              id="reference_number"
              value={formData.reference_number}
              onChange={(e) => handleChange('reference_number', e.target.value)}
              placeholder="e.g., Transaction ID, Check #"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Card transaction ID, mobile money reference, or check number
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="font-mono text-xs uppercase tracking-wider">
              Notes
            </Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Any additional notes..."
              rows={3}
            />
          </div>

          {/* Generate Receipt */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            <Checkbox
              id="generate_receipt"
              checked={generateReceipt}
              onCheckedChange={setGenerateReceipt}
            />
            <div className="flex-1">
              <Label htmlFor="generate_receipt" className="text-sm font-medium cursor-pointer">
                Generate Receipt
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically create a payment receipt
              </p>
            </div>
            <Receipt className="h-5 w-5 text-muted-foreground" />
          </div>
        </form>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card px-6 py-4 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={recordPaymentMutation.isPending}
          className="font-mono text-xs"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={recordPaymentMutation.isPending}
          className="font-mono text-xs bg-[oklch(0.70_0.17_155)] hover:bg-[oklch(0.65_0.17_155)]"
        >
          {recordPaymentMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Recording...
            </>
          ) : (
            <>
              <CreditCard className="h-4 w-4 mr-2" />
              Record Payment
            </>
          )}
        </Button>
      </footer>
    </div>
  );
}
