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
import { useState } from 'react';
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

import {
  usePatientInsurance,
  useDeletePatientInsurance,
} from '@/hooks/useBillingQueries';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import { PatientInsuranceFormSlideOver } from '@/components/billing';

/**
 * PatientInsuranceSlideOver - Slide-over for managing a patient's insurance records
 *
 * Shows all insurance for a patient with ability to:
 * - View existing insurance details
 * - Add new insurance
 * - Edit existing insurance
 * - Delete insurance
 */
export default function PatientInsuranceSlideOver({
  open,
  onClose,
  patient,
}) {
  const { user } = useAuth();
  const patientId = patient?.id || patient?.local_data?.id;
  const patientName = patient?.name ||
    (patient?.local_data?.user_details
      ? `${patient.local_data.user_details.first_name} ${patient.local_data.user_details.last_name}`
      : 'Patient');
  const userRole = user?.role || user?.user_type;
  const canManageInsurance = ['admin', 'billing'].includes(userRole);

  // Fetch patient's insurance records
  const {
    data: insuranceData,
    isLoading,
    error,
  } = usePatientInsurance(patientId, {}, { enabled: open });

  const insurances = insuranceData?.results || insuranceData || [];

  // Delete mutation
  const deleteMutation = useDeletePatientInsurance();

  // Form slide-over state
  const [showFormSlideOver, setShowFormSlideOver] = useState(false);
  const [editingInsurance, setEditingInsurance] = useState(null);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [insuranceToDelete, setInsuranceToDelete] = useState(null);

  const handleAddInsurance = () => {
    setEditingInsurance(null);
    setShowFormSlideOver(true);
  };

  const handleEditInsurance = (insurance) => {
    setEditingInsurance(insurance);
    setShowFormSlideOver(true);
  };

  const handleDeleteClick = (insurance) => {
    setInsuranceToDelete(insurance);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!insuranceToDelete) return;

    try {
      await deleteMutation.mutateAsync(insuranceToDelete.id);
      toast.success('Insurance deleted successfully');
      setDeleteDialogOpen(false);
      setInsuranceToDelete(null);
    } catch (err) {
      toast.error(err.message || 'Failed to delete insurance');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return null;
    try {
      return format(parseISO(dateString), 'MMM d, yyyy');
    } catch {
      return dateString;
    }
  };

  const isInsuranceValid = (insurance) => {
    if (!insurance.is_active) return false;
    if (!insurance.valid_until) return true;
    return new Date(insurance.valid_until) >= new Date();
  };

  return (
    <>
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
            <div className="p-2 rounded-lg bg-[oklch(0.70_0.15_230_/_0.1)]">
              <Shield className="h-5 w-5 text-[oklch(0.70_0.15_230)]" />
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
            <X className="h-4 w-4" />
          </Button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(2)].map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-muted-foreground">Failed to load insurance</p>
            </div>
          ) : insurances.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="font-display text-lg text-foreground mb-2">No Insurance</h3>
              <p className="text-muted-foreground text-sm mb-6">
                This patient has no insurance on file
              </p>
              {canManageInsurance ? (
                <Button onClick={handleAddInsurance} className="font-mono text-xs">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Insurance
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Billing staff can add insurance records.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {insurances.map((insurance) => {
                const isValid = isInsuranceValid(insurance);

                return (
                  <div
                    key={insurance.id}
                    className={cn(
                      'bg-card border rounded-xl p-4',
                      isValid ? 'border-border' : 'border-muted opacity-60'
                    )}
                  >
                    {/* Status + Provider */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {isValid ? (
                          <CheckCircle className="h-4 w-4 text-[oklch(0.70_0.17_155)]" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
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
                            onClick={() => handleEditInsurance(insurance)}
                            className="h-8 w-8 p-0"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteClick(insurance)}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Plan Name */}
                    <h3 className="font-display text-lg text-foreground mb-1">
                      {insurance.plan_name || 'Unknown Plan'}
                    </h3>

                    {/* Provider */}
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                      <Building className="h-3.5 w-3.5" />
                      {insurance.provider_name || 'Unknown Provider'}
                    </div>

                    {/* Details Grid */}
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

                    {/* Validity Period */}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {formatDate(insurance.valid_from)}
                        {insurance.valid_until
                          ? ` - ${formatDate(insurance.valid_until)}`
                          : ' (No expiry)'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {insurances.length > 0 && canManageInsurance && (
          <footer className="border-t border-border bg-card px-6 py-4">
            <Button
              onClick={handleAddInsurance}
              variant="outline"
              className="w-full font-mono text-xs"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Another Insurance
            </Button>
          </footer>
        )}
      </div>

      {/* Form Slide-Over for Add/Edit */}
      {canManageInsurance && (
        <>
          <PatientInsuranceFormSlideOver
            open={showFormSlideOver}
            onClose={() => {
              setShowFormSlideOver(false);
              setEditingInsurance(null);
            }}
            insurance={editingInsurance ? {
              ...editingInsurance,
              patient: patientId,
              patient_details: { id: patientId, name: patientName },
            } : null}
            // Pre-fill patient for new insurance
            defaultPatient={!editingInsurance ? {
              id: patientId,
              name: patientName,
            } : null}
          />

          {/* Delete Confirmation Dialog */}
          <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
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
                  onClick={handleConfirmDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </>
  );
}
