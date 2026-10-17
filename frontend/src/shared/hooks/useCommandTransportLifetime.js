import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';

// Workflow continuity may retain a draft while a same-session proof rotates
// request credentials. Already-dispatched work must not publish under that new
// proof or remain permanently pending. Its original command stays review-only.
export function useCommandTransportLifetime(operation, onInterrupted) {
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const previous = useRef(transport); const interrupted = useRef(new WeakSet());
  useLayoutEffect(() => {
    if (previous.current !== transport && operation.current) {
      const controller = operation.current; interrupted.current.add(controller);
      operation.current = null; controller.abort(); onInterrupted();
    }
    previous.current = transport;
  }, [transport, operation, onInterrupted]);
  return useCallback((controller) => interrupted.current.has(controller), []);
}
