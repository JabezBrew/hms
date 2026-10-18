import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { canReadOrganization } from './access';
export function useOrganizationAccess() {
  const { user } = useAuth(), network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const canRead = canReadOrganization(user), canRecover = canRead && network?.networkConfirmed === true && network.canRead === true, canWrite = canRecover && network.isReadOnly === false;
  return { user, canRead, canWrite, canRecover, scope: hashQueryValue(JSON.stringify([authorizationScope(user, transport), canRead, canWrite, network?.networkDecision?.policy_version])) };
}
