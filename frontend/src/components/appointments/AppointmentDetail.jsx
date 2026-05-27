import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import {
  useAppointment,
  useUpdateAppointmentStatus,
  useCancelAppointment,
  useDeleteAppointment,
} from '@/features/appointments/hooks/useAppointmentQueries';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { AppointmentDetailContent } from './AppointmentDetailContent';
import { AppointmentDetailEmptyState } from './AppointmentDetailEmptyState';
import { AppointmentDetailErrorState } from './AppointmentDetailErrorState';
import { AppointmentDetailHeader } from './AppointmentDetailHeader';
import { AppointmentDetailLoadingState } from './AppointmentDetailLoadingState';
import {
  getAppointmentActionState,
  getAppointmentPatient,
  getAppointmentPractitioner,
  getAppointmentRange,
} from './appointmentDetailUtils';

const AppointmentDetail = ({ appointmentId, onBack }) => {
  const navigate = useNavigate();
  const [cancellationReason, setCancellationReason] = useState('');

  const {
    data: appointment,
    isLoading,
    isError,
    error,
  } = useAppointment(appointmentId);
  const updateStatusMutation = useUpdateAppointmentStatus();
  const cancelAppointmentMutation = useCancelAppointment();
  const deleteMutation = useDeleteAppointment();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }

    navigate('/appointments');
  };

  const handleStatusUpdate = (newStatus) => {
    updateStatusMutation.mutate(
      { id: appointmentId, status: newStatus },
      {
        onSuccess: () => {
          toast.success(`Appointment status updated to ${newStatus}`);
        },
        onError: (mutationError) => {
          toast.error(mutationError?.message || 'Failed to update appointment status');
        },
      }
    );
  };

  const handleCancelAppointment = (event) => {
    const reason = cancellationReason.trim();
    if (!reason) {
      event?.preventDefault();
      toast.error('Enter a cancellation reason');
      return;
    }

    cancelAppointmentMutation.mutate(
      { id: appointmentId, reason },
      {
        onSuccess: () => {
          setCancellationReason('');
          toast.success('Appointment cancelled');
        },
        onError: (mutationError) => {
          event?.preventDefault();
          toast.error(mutationError?.message || 'Failed to cancel appointment');
        },
      }
    );
  };

  const handleDelete = () => {
    deleteMutation.mutate(appointmentId, {
      onSuccess: () => {
        toast.success('Appointment deleted successfully');
        handleBack();
      },
      onError: (mutationError) => {
        toast.error(mutationError?.message || 'Failed to delete appointment');
      },
    });
  };

  const handleEdit = () => {
    navigate(`/appointments/${appointmentId}/edit`);
  };

  if (isLoading) {
    return <AppointmentDetailLoadingState />;
  }

  if (isError) {
    return (
      <AppointmentDetailErrorState
        message={error?.message}
        onBack={handleBack}
      />
    );
  }

  if (!appointment) {
    return <AppointmentDetailEmptyState onBack={handleBack} />;
  }

  const patient = getAppointmentPatient(appointment);
  const practitioner = getAppointmentPractitioner(appointment);
  const timeRange = getAppointmentRange(appointment);
  const actionState = getAppointmentActionState(appointment, isRustV2ApiMode());

  return (
    <div className="space-y-6 animate-chronicle-enter">
      <AppointmentDetailHeader
        actionState={actionState}
        appointment={appointment}
        cancellationReason={cancellationReason}
        cancelAppointmentMutation={cancelAppointmentMutation}
        deleteMutation={deleteMutation}
        onBack={handleBack}
        onCancelAppointment={handleCancelAppointment}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onStatusUpdate={handleStatusUpdate}
        patient={patient}
        practitioner={practitioner}
        setCancellationReason={setCancellationReason}
        timeRange={timeRange}
        updateStatusMutation={updateStatusMutation}
      />

      <AppointmentDetailContent
        appointment={appointment}
        onNavigate={navigate}
        patient={patient}
        practitioner={practitioner}
        timeRange={timeRange}
      />
    </div>
  );
};

export default AppointmentDetail;
