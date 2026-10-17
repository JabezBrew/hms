import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { useChronicleClinicalPermissions } from '@/features/patients/chronicle/clinicalPermissions';
import { consultationPermission } from '../access';
export function useConsultationAccess(preparationOnly = false) {
  const { user } = useAuth(), clinical = useChronicleClinicalPermissions(), network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey), permission = consultationPermission(user, clinical, preparationOnly);
  const canWrite = permission.canManage && network?.networkConfirmed === true && network.canRead === true && network.isReadOnly === false;
  return { user, ...permission, canWrite, scope: hashQueryValue(JSON.stringify([authorizationScope(user, transport), permission.canRead, canWrite, network?.networkDecision?.policy_version])) };
}
