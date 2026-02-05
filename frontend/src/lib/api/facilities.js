import { apiClient, handleApiError } from "../api-client";

export const facilitiesApi = {
  listFacilities: async ({ includeInactive = false } = {}) => {
    try {
      const params = new URLSearchParams();
      if (includeInactive) {
        params.set("include_inactive", "1");
      }
      const query = params.toString();
      const endpoint = query ? `/facilities/?${query}` : "/facilities/";
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, "Failed to load facilities"));
    }
  },
};
