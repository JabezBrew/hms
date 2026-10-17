import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { canUseAdmissionAdvisories } from './access';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { useChronicleClinicalPermissions } from '@/features/patients/chronicle/clinicalPermissions';

export function useAdvisoryAccess(proof) {
  const { user } = useAuth(); const inherited = useChronicleClinicalPermissions(); const network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const full = inherited?.can_view_full_clinical === true && (!proof || proof.can_view_full_clinical === true);
  const canRead = canUseAdmissionAdvisories(user, full);
  const canWrite = canRead && network?.networkConfirmed === true && network.canRead === true && network.isReadOnly === false;
  const scope = hashQueryValue(JSON.stringify([authorizationScope(user, transport), canRead, canWrite, network?.networkDecision?.policy_version]));
  return { user, scope, canRead, canWrite };
}
