import { apiClient, handleApiError } from "../api-client";

export const interopApi = {
  createExport: async (payload) => {
    try {
      return await apiClient.post("/interop/exports/", payload);
    } catch (error) {
      throw new Error(handleApiError(error, "Failed to create export"));
    }
  },

  retrieveExport: async ({
    exportId,
    consentToken,
    sourceFacilityCode,
    requestingFacilityCode,
  }) => {
    try {
      const headers = {
        "X-Consent-Token": consentToken,
      };
      if (sourceFacilityCode) {
        headers["X-Facility-Code"] = sourceFacilityCode;
      }
      if (requestingFacilityCode) {
        headers["X-Requesting-Facility-Code"] = requestingFacilityCode;
      }
      return await apiClient.get(`/interop/exports/${exportId}/`, { headers });
    } catch (error) {
      throw new Error(handleApiError(error, "Failed to retrieve export"));
    }
  },
};
