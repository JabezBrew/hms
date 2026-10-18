import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { canReadLocations, canManageLocations } from './access';
export function useStorageLocationAccess() {
  const { user } = useAuth(), network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const canRead = canReadLocations(user), canManage = canManageLocations(user);
  const canRecover = canManage && network?.networkConfirmed === true && network.canRead === true;
  const canWrite = canRecover && network.isReadOnly === false;
  return { user, canRead, canManage, canWrite, canRecover, scope: hashQueryValue(JSON.stringify([authorizationScope(user, transport), canRead, canManage, network?.networkDecision?.policy_version])) };
}
