import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { v2Api } from '@/lib/api/v2/client';
import { toast } from 'sonner';

/**
 * Hook for dashboard action handlers
 * Provides mutations for medication administration, task completion, check-in, etc.
 */

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeV2AppointmentPayload(data = {}) {
  const patientId = data.patient_id || data.patient;
  const startsAt = data.starts_at || data.start_time || data.start;
  const endsAt = data.ends_at || data.end_time || data.end;
  if (!patientId || !startsAt || !endsAt) {
    throw new Error('Patient, start time, and end time are required to schedule an appointment in Rust V2');
  }
  return {
    patient_id: patientId,
    starts_at: startsAt,
    ends_at: endsAt,
  };
}

function normalizeV2VitalsPayload(vitalsData = {}) {
  const admissionCaseId = vitalsData.admission_case_id
    || vitalsData.admissionCaseId
    || vitalsData.admission_id
    || vitalsData.admission?.id;
  if (!admissionCaseId) {
    throw new Error('Active admission is required to record vitals in Rust V2');
  }
  return {
    admission_case_id: admissionCaseId,
    recorded_at: vitalsData.recorded_at || new Date().toISOString(),
    temperature_c: normalizeOptionalNumber(vitalsData.temperature_c ?? vitalsData.temperature),
    systolic_bp: normalizeOptionalNumber(vitalsData.systolic_bp ?? vitalsData.blood_pressure_systolic),
    diastolic_bp: normalizeOptionalNumber(vitalsData.diastolic_bp ?? vitalsData.blood_pressure_diastolic),
    pulse: normalizeOptionalNumber(vitalsData.pulse ?? vitalsData.heart_rate),
    respiratory_rate: normalizeOptionalNumber(vitalsData.respiratory_rate),
    oxygen_saturation: normalizeOptionalNumber(vitalsData.oxygen_saturation ?? vitalsData.spo2),
  };
}

function normalizeV2MedicationAdministrationPayload(administrationData = {}) {
  return {
    witness_user_id: administrationData.witness_user_id
      || administrationData.witnessUserId
      || administrationData.witness
      || null,
  };
}

function unwrapV2Object(response) {
  return response?.data ?? response;
}

function rethrowV2DashboardError(error, fallbackMessage) {
  throw new Error(handleV2ApiError(error, fallbackMessage));
}

export function useDashboardActions() {
  const queryClient = useQueryClient();

  // Administer medication
  const administerMedication = useMutation({
    mutationFn: async ({ medicationId, administrationData }) => {
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postMedicationAdministrationAdminister(
            { id: medicationId },
            normalizeV2MedicationAdministrationPayload(administrationData),
          );
          return unwrapV2Object(response);
        } catch (error) {
          rethrowV2DashboardError(error, 'Failed to administer medication');
        }
      }
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
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postNursingTaskComplete({ id: taskId });
          return unwrapV2Object(response);
        } catch (error) {
          rethrowV2DashboardError(error, 'Failed to complete task');
        }
      }
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
    mutationFn: async ({ appointmentId, patientId, clinicId }) => {
      if (isRustV2ApiMode()) {
        if (!patientId) {
          throw new Error('Patient id is required to check in a patient in Rust V2');
        }
        try {
          const response = await v2Api.postVisitCheckIn({
            patient_id: patientId,
            appointment_id: appointmentId || null,
            clinic_id: clinicId || null,
          });
          return unwrapV2Object(response);
        } catch (error) {
          rethrowV2DashboardError(error, 'Failed to check in patient');
        }
      }
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
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postNursingAlertAcknowledge({ id: alertId });
          return unwrapV2Object(response);
        } catch (error) {
          rethrowV2DashboardError(error, 'Failed to acknowledge alert');
        }
      }
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
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postAppointments(normalizeV2AppointmentPayload(appointmentData));
          return unwrapV2Object(response);
        } catch (error) {
          rethrowV2DashboardError(error, 'Failed to schedule appointment');
        }
      }
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
      if (isRustV2ApiMode()) {
        throw new Error('Bed status updates are not available in Rust V2');
      }
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
      if (isRustV2ApiMode()) {
        try {
          const response = await v2Api.postPatientVitals(normalizeV2VitalsPayload({
            patient_id: patientId,
            ...vitalsData,
          }));
          return unwrapV2Object(response);
        } catch (error) {
          rethrowV2DashboardError(error, 'Failed to record vitals');
        }
      }
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
