import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { userHasCapability } from '@/shared/lib/access';
import { useChronicleClinicalPermissions } from '@/features/patients/chronicle/clinicalPermissions';
export function useResponseAccess() {
  const { user } = useAuth(); const permissions = useChronicleClinicalPermissions(); const network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const context = user?.accessContext;
  const canRead = Boolean(permissions.can_view_full_clinical && context?.patient_visibility?.includes('full_clinical') && ['patients', 'referrals'].every(feature => context?.features?.includes(feature)) && userHasCapability(user, 'referral.manage') && userHasCapability(user, 'patient.demographics.view'));
  const canWrite = canRead && network?.networkConfirmed === true && network.canRead === true && network.isReadOnly === false;
  const scope = hashQueryValue(JSON.stringify([authorizationScope(user, transport), canRead, canWrite, network?.networkDecision?.policy_version]));
  return { user, scope, canRead, canWrite };
}
