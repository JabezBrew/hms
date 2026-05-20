import { apiClient, handleApiError } from "../api-client";
import { isRustV2ApiMode } from "./v2/runtime";

const RUST_V2_INTEROP_DEFERRED_MESSAGE =
  "Interop/FHIR export is intentionally deferred in Rust V2 pending product decisions on resources, destinations, consent linkage, and retention/audit rules.";

export const interopApi = {
  createExport: async (payload) => {
    if (isRustV2ApiMode()) {
      throw new Error(RUST_V2_INTEROP_DEFERRED_MESSAGE);
    }
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
    if (isRustV2ApiMode()) {
      throw new Error(RUST_V2_INTEROP_DEFERRED_MESSAGE);
    }
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
