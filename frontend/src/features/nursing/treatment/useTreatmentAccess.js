import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { useChronicleClinicalPermissions } from '@/features/patients/chronicle/clinicalPermissions';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { userHasCapability } from '@/shared/lib/access';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { canUseTreatmentCourses } from './access';
export function useTreatmentAccess(proof) {
  const { user } = useAuth(); const inherited = useChronicleClinicalPermissions(); const network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const full = inherited?.can_view_full_clinical === true && (!proof || proof.can_view_full_clinical === true);
  const canRead = canUseTreatmentCourses(user, full) && network?.canRead !== false;
  const manages = userHasCapability(user, 'clinical_documentation.manage');
  const canWrite = canRead && manages && network?.networkConfirmed === true && network.canRead === true && network.isReadOnly === false;
  const scope = hashQueryValue(JSON.stringify([authorizationScope(user, transport), canRead, canWrite, network?.networkDecision?.policy_version]));
  return { user, scope, canRead, canWrite, readonlyMessage: network?.isReadOnly ? network.readonlyMessage : !manages ? 'Current permission allows course review. Changes require prescribing permission for this workflow.' : null };
}
