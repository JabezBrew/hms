import X from 'lucide-react/dist/esm/icons/x.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Edit from 'lucide-react/dist/esm/icons/square-pen.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import XCircle from 'lucide-react/dist/esm/icons/circle-x.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Building from 'lucide-react/dist/esm/icons/building.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function formatInsuranceDate(dateString) {
  if (!dateString) return null;
  try {
    return format(parseISO(dateString), 'MMM d, yyyy');
  } catch {
    return dateString;
  }
}

function isInsuranceValid(insurance) {
  if (!insurance.is_active) return false;
  if (!insurance.valid_until) return true;
  return new Date(insurance.valid_until) >= new Date();
}

export function PatientInsurancePanel({ open, children }) {
  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full lg:w-[480px] bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {children}
    </div>
  );
}

export function PatientInsuranceHeader({ patientName, onClose }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[oklch(0.70_0.15_230_/_0.1)]">
          <Shield className="size-5 text-[oklch(0.70_0.15_230)]" />
        </div>
        <div>
          <h2 className="font-display text-xl text-foreground">Insurance</h2>
          <p className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">
            {patientName}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        className="font-mono text-xs"
      >
        <X className="size-4" />
      </Button>
    </header>
  );
}

export function PatientInsuranceContent({
  isLoading,
  error,
  insurances,
  canManageInsurance,
  onAddInsurance,
  onEditInsurance,
  onDeleteInsurance,
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {isLoading ? (
        <PatientInsuranceLoading />
      ) : error ? (
        <PatientInsuranceError />
      ) : insurances.length === 0 ? (
        <PatientInsuranceEmpty
          canManageInsurance={canManageInsurance}
          onAddInsurance={onAddInsurance}
        />
      ) : (
        <PatientInsuranceList
          insurances={insurances}
          canManageInsurance={canManageInsurance}
          onEditInsurance={onEditInsurance}
          onDeleteInsurance={onDeleteInsurance}
        />
      )}
    </div>
  );
}

function PatientInsuranceLoading() {
  return (
    <div className="space-y-4">
      {[...Array(2)].map((_, i) => (
        <Skeleton key={i} className="h-32 rounded-xl" />
      ))}
    </div>
  );
}

function PatientInsuranceError() {
  return (
    <div className="text-center py-8">
      <AlertTriangle className="size-10 text-destructive mx-auto mb-3" />
      <p className="text-muted-foreground">Failed to load insurance</p>
    </div>
  );
}

function PatientInsuranceEmpty({ canManageInsurance, onAddInsurance }) {
  return (
    <div className="text-center py-12">
      <Shield className="size-12 text-muted-foreground/30 mx-auto mb-4" />
      <h3 className="font-display text-lg text-foreground mb-2">No Insurance</h3>
      <p className="text-muted-foreground text-sm mb-6">
        This patient has no insurance on file
      </p>
      {canManageInsurance ? (
        <Button onClick={onAddInsurance} className="font-mono text-xs">
          <Plus className="size-4 mr-2" />
          Add Insurance
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Billing staff can add insurance records.
        </p>
      )}
    </div>
  );
}

function PatientInsuranceList({
  insurances,
  canManageInsurance,
  onEditInsurance,
  onDeleteInsurance,
}) {
  return (
    <div className="space-y-4">
      {insurances.map((insurance) => (
        <PatientInsuranceCard
          key={insurance.id}
          insurance={insurance}
          canManageInsurance={canManageInsurance}
          onEditInsurance={onEditInsurance}
          onDeleteInsurance={onDeleteInsurance}
        />
      ))}
    </div>
  );
}

function PatientInsuranceCard({
  insurance,
  canManageInsurance,
  onEditInsurance,
  onDeleteInsurance,
}) {
  const isValid = isInsuranceValid(insurance);

  return (
    <div
      className={cn(
        'bg-card border rounded-xl p-4',
        isValid ? 'border-border' : 'border-muted opacity-60'
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {isValid ? (
            <CheckCircle className="size-4 text-[oklch(0.70_0.17_155)]" />
          ) : (
            <XCircle className="size-4 text-muted-foreground" />
          )}
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded',
              isValid
                ? 'badge-chronicle-emerald'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {isValid ? 'Active' : 'Inactive'}
          </span>
        </div>
        {canManageInsurance && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEditInsurance(insurance)}
              className="size-8 p-0"
            >
              <Edit className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeleteInsurance(insurance)}
              className="size-8 p-0 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      <h3 className="font-display text-lg text-foreground mb-1">
        {insurance.plan_name || 'Unknown Plan'}
      </h3>

      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
        <Building className="size-3.5" />
        {insurance.provider_name || 'Unknown Provider'}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Policy Number
          </p>
          <p className="font-mono text-foreground">{insurance.policy_number}</p>
        </div>
        <div>
          <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-1">
            Coverage
          </p>
          <p className="font-mono text-[oklch(0.70_0.15_230)]">
            {insurance.coverage_percentage || 0}%
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
        <Calendar className="size-3" />
        <span>
          {formatInsuranceDate(insurance.valid_from)}
          {insurance.valid_until
            ? ` - ${formatInsuranceDate(insurance.valid_until)}`
            : ' (No expiry)'}
        </span>
      </div>
    </div>
  );
}

export function PatientInsuranceFooter({ show, onAddInsurance }) {
  if (!show) return null;

  return (
    <footer className="border-t border-border bg-card px-6 py-4">
      <Button
        onClick={onAddInsurance}
        variant="outline"
        className="w-full font-mono text-xs"
      >
        <Plus className="size-4 mr-2" />
        Add Another Insurance
      </Button>
    </footer>
  );
}

export function DeleteInsuranceDialog({
  open,
  onOpenChange,
  onConfirmDelete,
  isDeleting,
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Insurance</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this insurance record? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
