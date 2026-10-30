import { useQuery } from '@tanstack/react-query';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { serviceApi } from './api';
import { validId } from './model';
import { useBookableServiceAccess } from './useBookableServiceAccess';

// A booking selection is checked independently of a cached, bounded choice page.
// Existing booked-care views can still read an exact retired service.
export function useSelectedService(id) {
  const access = useBookableServiceAccess(), rust = isRustV2ApiMode();
  const query = useQuery({ queryKey: ['appointments', 'types', 'selected', access.scope, id || null], queryFn: ({ signal }) => serviceApi.get(id, { signal }), enabled: rust && access.canRead && validId(id), retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const refresh = () => access.canRead && validId(id) ? query.refetch() : Promise.resolve();
  if (!rust) return { ready: Boolean(id), unavailable: false, denied: false, service: null, canRead: true, refresh, message: null };
  const ready = access.canWrite && !query.isFetching && !query.isError && query.data?.id === id && query.data.is_active === true;
  const unavailable = Boolean(id) && (!access.canRead || (!query.isFetching && (query.isError || query.data?.is_active === false)));
  return { ready, unavailable, denied: !access.canRead || query.error?.status === 403, service: query.data, canRead: access.canRead, refresh, message: !id ? null : unavailable ? 'The selected service is unavailable for new bookings. Choose and review an active service. Existing appointments have not been cancelled.' : !access.canWrite ? 'New bookings require current appointment management authority and network access.' : !ready ? 'Confirming the selected service before a new booking.' : null };
}
