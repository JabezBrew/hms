import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { authorizationScope, requestAuthorizationScope } from '@/shared/lib/authorizationScope';
import { canReadCategories, canManageCategories } from './access';
export function useCategoryAccess() {
  const { user } = useAuth(), network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const canRead = canReadCategories(user), canManage = canManageCategories(user);
  const readReady = canRead && network?.networkConfirmed === true && network.canRead === true && networkClockCurrent(network.networkDecision);
  return { user, transport, requestScope: requestAuthorizationScope(user, transport), scope: authorizationScope(user, transport), canRead, canManage, readReady,
    canRecover: canManage && readReady, canWrite: canManage && readReady && network.isReadOnly === false };
}
