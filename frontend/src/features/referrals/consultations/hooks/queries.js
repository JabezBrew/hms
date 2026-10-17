import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { consultationApi } from '../api';
import { consultationKeys } from '../keys';
export function useConsultationContext(scope, proof, source, enabled) {
  return useQuery({ queryKey: consultationKeys.context(proof, scope, source), queryFn: ({ signal }) => consultationApi.context(scope, source, { signal }), enabled, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: enabled ? 15000 : false });
}
export function useSelectedConsultationSource({ scope, access, source, open, onDenied }) {
  const query = useConsultationContext(scope, access.scope, source, open && Boolean(source));
  const denied = query.error?.status === 403;
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  const ready = Boolean(source && query.isFetchedAfterMount && !query.isError && query.data);
  const current = ready ? query.data : null;
  return { query, ready, current, allowed: Boolean(ready && !query.isFetching && access.canWrite && current.can_start) };
}
