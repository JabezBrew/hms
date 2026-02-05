import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';

/**
 * Hook for dashboard action handlers
 * Provides mutations for medication administration, task completion, check-in, etc.
 */

export function useDashboardActions() {
  const queryClient = useQueryClient();

  // Administer medication
  const administerMedication = useMutation({
    mutationFn: async ({ medicationId, administrationData }) => {
      return await apiClient.patch(
        `/nursing/medication-administration/${medicationId}/administer/`,
        administrationData
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['dashboards']);
      queryClient.invalidateQueries(['nursing']);
      toast.success('Medication administered successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to administer medication');
    },
  });

  // Complete nursing task
  const completeTask = useMutation({
    mutationFn: async ({ taskId, completionNotes }) => {
      return await apiClient.patch(`/nursing/tasks/${taskId}/complete/`, {
        completion_notes: completionNotes,
        completed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['dashboards']);
      queryClient.invalidateQueries(['nursing']);
      toast.success('Task completed successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to complete task');
    },
  });

  // Check-in patient for appointment (starts outpatient visit)
  const checkInPatient = useMutation({
    mutationFn: async ({ appointmentId }) => {
      return await apiClient.post(`/appointments/appointments/${appointmentId}/start_visit/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['dashboards']);
      queryClient.invalidateQueries(['appointments']);
      queryClient.invalidateQueries(['visits']);
      queryClient.invalidateQueries(['encounters']);
      toast.success('Patient checked in successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to check in patient');
    },
  });

  // Acknowledge alert
  const acknowledgeAlert = useMutation({
    mutationFn: async ({ alertId, notes }) => {
      return await apiClient.patch(`/nursing/alerts/${alertId}/acknowledge/`, {
        acknowledged_at: new Date().toISOString(),
        acknowledgment_notes: notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['dashboards']);
      queryClient.invalidateQueries(['nursing']);
      toast.success('Alert acknowledged');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to acknowledge alert');
    },
  });

  // Schedule appointment (for receptionists)
  const scheduleAppointment = useMutation({
    mutationFn: async (appointmentData) => {
      return await apiClient.post('/appointments/', appointmentData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['dashboards']);
      queryClient.invalidateQueries(['appointments']);
      toast.success('Appointment scheduled successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to schedule appointment');
    },
  });

  // Update bed status (for admins)
  const updateBedStatus = useMutation({
    mutationFn: async ({ bedId, status, notes }) => {
      return await apiClient.patch(`/wards/beds/${bedId}/`, {
        status,
        notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['dashboards']);
      queryClient.invalidateQueries(['wards']);
      toast.success('Bed status updated');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update bed status');
    },
  });

  // Vitals recording
  const recordVitals = useMutation({
    mutationFn: async ({ patientId, vitalsData }) => {
      return await apiClient.post(`/nursing/vitals/`, {
        patient: patientId,
        ...vitalsData,
        recorded_at: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['dashboards']);
      queryClient.invalidateQueries(['nursing']);
      queryClient.invalidateQueries(['patients']);
      toast.success('Vitals recorded successfully');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to record vitals');
    },
  });

  return {
    administerMedication,
    completeTask,
    checkInPatient,
    acknowledgeAlert,
    scheduleAppointment,
    updateBedStatus,
    recordVitals,
  };
}
