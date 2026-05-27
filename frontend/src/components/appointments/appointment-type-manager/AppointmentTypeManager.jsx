import {
  useAppointmentTypes,
} from '@/features/appointments/hooks/useAppointmentQueries';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

import { AppointmentTypeDeleteDialog } from './AppointmentTypeDeleteDialog';
import { AppointmentTypeDialog } from './AppointmentTypeDialog';
import { AppointmentTypeEmptyState } from './AppointmentTypeEmptyState';
import { AppointmentTypeHeader } from './AppointmentTypeHeader';
import { AppointmentTypeTable } from './AppointmentTypeTable';
import { COLOR_OPTIONS, CATEGORY_OPTIONS } from './appointmentTypeOptions';
import { useAppointmentTypeManagerController } from './useAppointmentTypeManagerController';

const AppointmentTypeManager = () => {
  const appointmentTypeMutationsAvailable = !isRustV2ApiMode();
  const {
    data: appointmentTypes = [],
    isLoading: loading,
  } = useAppointmentTypes();

  const controller = useAppointmentTypeManagerController();

  return (
    <div className="space-y-4">
      <AppointmentTypeHeader
        canMutate={appointmentTypeMutationsAvailable}
        onAddNew={controller.handleAddNew}
      />

      {!appointmentTypeMutationsAvailable ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Appointment type management is not available in Rust V2 yet. Existing default
          types remain available for scheduling.
        </div>
      ) : null}

      {loading ? (
        <div className="text-center py-4">Loading appointment types…</div>
      ) : appointmentTypes.length === 0 ? (
        <AppointmentTypeEmptyState
          canMutate={appointmentTypeMutationsAvailable}
          onAddNew={controller.handleAddNew}
        />
      ) : (
        <AppointmentTypeTable
          appointmentTypes={appointmentTypes}
          canMutate={appointmentTypeMutationsAvailable}
          colorOptions={COLOR_OPTIONS}
          categoryOptions={CATEGORY_OPTIONS}
          onEdit={controller.handleEdit}
          onDelete={controller.handleDelete}
        />
      )}

      <AppointmentTypeDialog
        open={controller.isDialogOpen}
        onOpenChange={controller.setIsDialogOpen}
        isEditing={controller.isEditing}
        currentAppointmentType={controller.currentAppointmentType}
        colorOptions={COLOR_OPTIONS}
        categoryOptions={CATEGORY_OPTIONS}
        onInputChange={controller.handleInputChange}
        onSelectChange={controller.handleSelectChange}
        onSwitchChange={controller.handleSwitchChange}
        onCancel={controller.handleCancel}
        onSubmit={controller.handleSubmit}
      />

      <AppointmentTypeDeleteDialog
        open={controller.isDeleteDialogOpen}
        onOpenChange={controller.setIsDeleteDialogOpen}
        onCancel={controller.handleDeleteCancel}
        onConfirm={controller.confirmDelete}
      />
    </div>
  );
};

export default AppointmentTypeManager;
