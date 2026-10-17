import { useSyncExternalStore } from 'react';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/session';
import { requestAuthorizationScope } from '@/shared/lib/authorizationScope';
export function useAuthScope(user) {
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, () => 'server');
  return requestAuthorizationScope(user, transport);
}
