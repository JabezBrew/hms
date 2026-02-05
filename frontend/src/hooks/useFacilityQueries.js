import { useQuery } from "@tanstack/react-query";
import { facilitiesApi } from '@/shared/api/facilities';
import { keyWith } from '@/shared/lib/queryKeys';

const facilitiesKeys = {
  list: (includeInactive) => keyWith('facilities', includeInactive),
};

export function useFacilities({ includeInactive = false } = {}) {
  return useQuery({
    queryKey: facilitiesKeys.list(includeInactive),
    queryFn: () => facilitiesApi.listFacilities({ includeInactive }),
    staleTime: 5 * 60 * 1000,
  });
}
