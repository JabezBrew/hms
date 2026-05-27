import { useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  useCreateAppointmentType,
  useUpdateAppointmentType,
  useDeleteAppointmentType,
} from '@/features/appointments/hooks/useAppointmentQueries';

import { APPOINTMENT_TYPE_DEFAULTS } from './appointmentTypeOptions';

const getCleanAppointmentType = () => ({ ...APPOINTMENT_TYPE_DEFAULTS });

export function useAppointmentTypeManagerController() {
  const createAppointmentTypeMutation = useCreateAppointmentType();
  const updateAppointmentTypeMutation = useUpdateAppointmentType();
  const deleteAppointmentTypeMutation = useDeleteAppointmentType();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [currentAppointmentType, setCurrentAppointmentType] = useState(getCleanAppointmentType);
  const appointmentTypeToDeleteRef = useRef(null);

  const resetForm = () => {
    setCurrentAppointmentType(getCleanAppointmentType());
    setIsEditing(false);
  };

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setCurrentAppointmentType((current) => ({
      ...current,
      [name]: name === 'duration_minutes' ? parseInt(value, 10) || 0 : value,
    }));
  };

  const handleSwitchChange = (checked) => {
    setCurrentAppointmentType((current) => ({
      ...current,
      is_active: checked,
    }));
  };

  const handleSelectChange = (name, value) => {
    setCurrentAppointmentType((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleAddNew = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const handleEdit = (appointmentType) => {
    setCurrentAppointmentType(appointmentType);
    setIsEditing(true);
    setIsDialogOpen(true);
  };

  const handleCancel = () => {
    setIsDialogOpen(false);
    resetForm();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!currentAppointmentType.name) {
      toast.error('Name is required');
      return;
    }

    if (!currentAppointmentType.duration_minutes || currentAppointmentType.duration_minutes <= 0) {
      toast.error('Duration must be a positive number');
      return;
    }

    if (!currentAppointmentType.category) {
      toast.error('Category is required');
      return;
    }

    if (isEditing) {
      updateAppointmentTypeMutation.mutate(
        {
          id: currentAppointmentType.id,
          data: currentAppointmentType,
        },
        {
          onSuccess: () => {
            toast.success('Appointment type updated successfully');
            setIsDialogOpen(false);
            resetForm();
          },
          onError: (error) => {
            console.error('Error updating appointment type:', error);
            toast.error(error.message || 'Failed to update appointment type');
          },
        },
      );
      return;
    }

    createAppointmentTypeMutation.mutate(
      currentAppointmentType,
      {
        onSuccess: () => {
          toast.success('Appointment type created successfully');
          setIsDialogOpen(false);
          resetForm();
        },
        onError: (error) => {
          console.error('Error creating appointment type:', error);
          toast.error(error.message || 'Failed to create appointment type');
        },
      },
    );
  };

  const handleDelete = (id) => {
    appointmentTypeToDeleteRef.current = id;
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteCancel = () => {
    appointmentTypeToDeleteRef.current = null;
  };

  const confirmDelete = () => {
    const appointmentTypeToDelete = appointmentTypeToDeleteRef.current;
    if (!appointmentTypeToDelete) return;

    deleteAppointmentTypeMutation.mutate(
      appointmentTypeToDelete,
      {
        onSuccess: () => {
          toast.success('Appointment type deleted successfully');
          setIsDeleteDialogOpen(false);
          appointmentTypeToDeleteRef.current = null;
        },
        onError: (error) => {
          console.error('Error deleting appointment type:', error);
          toast.error(error.message || 'Failed to delete appointment type');
        },
      },
    );
  };

  return {
    isDialogOpen,
    setIsDialogOpen,
    isEditing,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    currentAppointmentType,
    handleAddNew,
    handleEdit,
    handleCancel,
    handleInputChange,
    handleSwitchChange,
    handleSelectChange,
    handleSubmit,
    handleDelete,
    handleDeleteCancel,
    confirmDelete,
  };
}
