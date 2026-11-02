import { useLayoutEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
// Data can remain in Query memory while a connection is rechecked. Rendering
// requires the same captured live lease as the actual successful response.
export function useCategoryRead({ access, queryKey, read, onDenied, enabled = true }) {
  const capture = useScopedNotifications(access.scope), mounted = useRef(false), request = useRef(null);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current = null; }; }, []);
  const query = useQuery({ queryKey: [...queryKey, { request_scope: access.requestScope }], enabled: enabled && access.readReady, retry: false, staleTime: 0, gcTime: 0, structuralSharing: false, refetchOnMount: 'always', refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const attempt = {}, lease = capture(); request.current = attempt;
      try {
        const result = await read(signal);
        if (signal.aborted || !mounted.current || request.current !== attempt || !lease.isCurrent()) throw new DOMException('Aborted', 'AbortError');
        assertWriteRecoveryReadCurrent(result.response);
        return { ...result, lease };
      } catch (error) {
        if (!signal.aborted && mounted.current && request.current === attempt && isCurrentReadDenial(error)) onDenied();
        throw error;
      }
    },
  });
  const current = Boolean(access.readReady && !query.error && query.data?.lease.isCurrent());
  return { ...query, value: current ? query.data.value : null, response: current ? query.data.response : null, current };
}
