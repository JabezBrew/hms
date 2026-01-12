import { useQuery } from "@tanstack/react-query";
import { facilitiesApi } from "@/lib/api/facilities";

export function useFacilities({ includeInactive = false } = {}) {
  return useQuery({
    queryKey: ["facilities", includeInactive],
    queryFn: () => facilitiesApi.listFacilities({ includeInactive }),
    staleTime: 5 * 60 * 1000,
  });
}
