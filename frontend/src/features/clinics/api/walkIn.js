import { apiClient, handleApiError } from '@/lib/api-client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { v2Api } from '@/lib/api/v2/client';
import { adaptV2VisitForBridge } from '@/lib/api/visits';

export const clinicWalkInApi = {
  /**
   * Front-desk "Arrived now" check-in for pool clinics.
   * Creates a walk-in appointment aligned to the next roster slot and checks in the patient.
   */
  checkIn: async ({ patientId, clinicId, reason, signal } = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postVisitCheckIn(
          {
            patient_id: patientId,
            clinic_id: clinicId,
          },
          { signal: options.signal || signal },
        );
        return adaptV2VisitForBridge(response?.data);
      }

      return await apiClient.post('/appointments/appointments/walk-in-check-in/', {
        patient: patientId,
        clinic: clinicId,
        reason: reason || '',
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw error;
      }
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to check in walk-in patient'));
      }
      throw new Error(handleApiError(error, 'Failed to check in walk-in patient'));
    }
  },
};
