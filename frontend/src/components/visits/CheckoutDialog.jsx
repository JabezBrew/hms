import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import TestTube from 'lucide-react/dist/esm/icons/test-tube.js';
import CreditCard from 'lucide-react/dist/esm/icons/credit-card.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useVisit, useVisitActions } from '@/hooks/useVisitQueries';
import { useAuth } from '@/lib/auth';

/**
 * CheckoutDialog - Shows checkout requirements and handles checkout
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether dialog is open
 * @param {Function} props.onClose - Close handler
 * @param {string} props.encounterId - The encounter UUID
 * @param {Object} props.requirements - Checkout requirements status
 * @param {Function} props.onSuccess - Success callback
 */
export function CheckoutDialog({
  open,
  onClose,
  encounterId,
  requirements,
  onSuccess,
}) {
  const { user } = useAuth();
  const { data: visit, isLoading: isVisitLoading } = useVisit(encounterId, {
    enabled: open && Boolean(encounterId),
  });
  const { checkout } = useVisitActions();

  const isAdmin = user?.user_type === 'admin';
  const resolvedRequirements = requirements || visit?.checkout_requirements;

  // Check if all requirements are met
  const allMet = resolvedRequirements
    ? Object.keys(resolvedRequirements).length > 0
      && Object.values(resolvedRequirements).every((v) => v === true)
    : false;

  const handleCheckout = (force = false) => {
    checkout.mutate(
      { encounterId, force },
      {
        onSuccess: () => {
          onSuccess?.();
          onClose();
        },
      }
    );
  };

  const requirementItems = [
    {
      key: 'consultation_completed',
      label: 'Consultation completed',
      icon: Stethoscope,
    },
    {
      key: 'prescriptions_handled',
      label: 'Prescriptions dispensed',
      icon: Pill,
    },
    {
      key: 'lab_orders_cleared',
      label: 'Lab orders cleared',
      icon: TestTube,
    },
    {
      key: 'billing_cleared',
      label: 'Billing cleared',
      icon: CreditCard,
    },
  ];

  const getRequirementStatus = (key) => {
    if (!resolvedRequirements) return null;
    return resolvedRequirements[key];
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            Checkout Patient
          </DialogTitle>
          <DialogDescription>
            Review checkout requirements before completing the visit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isVisitLoading && (
            <div className="text-sm text-muted-foreground">
              Loading checkout requirements…
            </div>
          )}

          {/* Requirements List */}
          <div className="space-y-3">
            {requirementItems.map((item) => {
              const status = getRequirementStatus(item.key);
              const Icon = item.icon;

              // Skip if requirement not tracked
              if (status === undefined || status === null) return null;

              return (
                <div
                  key={item.key}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    status
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-rose-500/30 bg-rose-500/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      className={`size-5 ${
                        status ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    />
                    <span className="text-sm font-medium">{item.label}</span>
                  </div>
                  {status ? (
                    <CheckCircle className="size-5 text-emerald-400" />
                  ) : (
                    <XCircle className="size-5 text-rose-400" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Warning if requirements not met */}
          {!isVisitLoading && !allMet && (
            <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
              <AlertTriangle className="size-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-400">
                  Some requirements are not met
                </p>
                <p className="text-muted-foreground mt-1">
                  {isAdmin
                    ? 'As an admin, you can force checkout to override these requirements.'
                    : 'Please complete all requirements before checking out the patient.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {!allMet && isAdmin && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => handleCheckout(true)}
              disabled={checkout.isPending}
            >
              {checkout.isPending ? 'Processing...' : 'Force Checkout'}
            </Button>
          )}
          <Button
            type="button"
            onClick={() => handleCheckout(false)}
            disabled={checkout.isPending || isVisitLoading || !allMet}
          >
            {checkout.isPending ? 'Processing...' : 'Checkout'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CheckoutDialog;
