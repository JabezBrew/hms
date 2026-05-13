import { apiClient, handleApiError } from "../api-client";
import { handleV2ApiError } from "./v2/errors";
import { isRustV2ApiMode } from "./v2/runtime";
import { v2Api } from "./v2/client";

function adaptV2Facility(unit) {
  return {
    id: unit.id,
    code: unit.code,
    name: unit.name,
    is_active: unit.is_active !== false,
  };
}

function adaptV2FacilitiesResponse(response, includeInactive) {
  return (Array.isArray(response?.data) ? response.data : [])
    .filter((unit) => unit.unit_type === "facility")
    .map(adaptV2Facility)
    .filter((facility) => includeInactive || facility.is_active);
}

export const facilitiesApi = {
  listFacilities: async ({ includeInactive = false, signal } = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const query = { unit_type: "facility" };
        if (!includeInactive) {
          query.is_active = true;
        }
        const response = await v2Api.getAdminOrgUnits({
          query,
          signal,
        });
        return adaptV2FacilitiesResponse(response, includeInactive);
      }
      const params = new URLSearchParams();
      if (includeInactive) {
        params.set("include_inactive", "1");
      }
      const query = params.toString();
      const endpoint = query ? `/facilities/?${query}` : "/facilities/";
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, "Failed to load facilities"));
      }
      throw new Error(handleApiError(error, "Failed to load facilities"));
    }
  },
};
