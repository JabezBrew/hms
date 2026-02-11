import { apiClient, handleApiError } from '@/lib/api-client';

export const clinicWalkInApi = {
  /**
   * Front-desk "Arrived now" check-in for pool clinics.
   * Creates a walk-in appointment aligned to the next roster slot and checks in the patient.
   */
  checkIn: async ({ patientId, clinicId, reason }) => {
    try {
      return await apiClient.post('/appointments/appointments/walk-in-check-in/', {
        patient: patientId,
        clinic: clinicId,
        reason: reason || '',
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to check in walk-in patient'));
    }
  },
};

