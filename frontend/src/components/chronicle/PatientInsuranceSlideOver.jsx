import { useRef, useState } from 'react';
import {
  DeleteInsuranceDialog,
  PatientInsuranceContent,
  PatientInsuranceFooter,
  PatientInsuranceHeader,
  PatientInsurancePanel,
} from './PatientInsuranceSlideOverSections';

import {
  usePatientInsurance,
  useDeletePatientInsurance,
} from '@/features/billing/hooks';
import { useAuth } from '@/lib/auth';
import { toast } from 'sonner';
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
  const insuranceToDeleteRef = useRef(null);

  const handleAddInsurance = () => {
    setEditingInsurance(null);
    setShowFormSlideOver(true);
  };

  const handleEditInsurance = (insurance) => {
    setEditingInsurance(insurance);
    setShowFormSlideOver(true);
  };

  const handleDeleteClick = (insurance) => {
    insuranceToDeleteRef.current = insurance;
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    const insuranceToDelete = insuranceToDeleteRef.current;
    if (!insuranceToDelete) return;

    try {
      await deleteMutation.mutateAsync(insuranceToDelete.id);
      toast.success('Insurance deleted successfully');
      setDeleteDialogOpen(false);
      insuranceToDeleteRef.current = null;
    } catch (err) {
      toast.error(err.message || 'Failed to delete insurance');
    }
  };

  return (
    <>
      <PatientInsurancePanel open={open}>
        <PatientInsuranceHeader patientName={patientName} onClose={onClose} />
        <PatientInsuranceContent
          isLoading={isLoading}
          error={error}
          insurances={insurances}
          canManageInsurance={canManageInsurance}
          onAddInsurance={handleAddInsurance}
          onEditInsurance={handleEditInsurance}
          onDeleteInsurance={handleDeleteClick}
        />
        <PatientInsuranceFooter
          show={insurances.length > 0 && canManageInsurance}
          onAddInsurance={handleAddInsurance}
        />
      </PatientInsurancePanel>

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

          <DeleteInsuranceDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            onConfirmDelete={handleConfirmDelete}
            isDeleting={deleteMutation.isPending}
          />
        </>
      )}
    </>
  );
}
