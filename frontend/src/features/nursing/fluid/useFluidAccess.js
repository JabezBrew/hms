import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { useChronicleClinicalPermissions } from '@/features/patients/chronicle/clinicalPermissions';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { userHasCapability } from '@/shared/lib/access';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { fluidAccessScope } from './model';

/** Rich fluid evidence follows the same live proof as its Chronicle host. */
export function useFluidAccess(suppliedPermissions) {
  const { user } = useAuth(); const inherited = useChronicleClinicalPermissions(); const network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const context = user?.accessContext; const permissions = suppliedPermissions || inherited;
  const canRead = permissions?.can_view_full_clinical === true && context?.patient_visibility?.includes('full_clinical') === true
    && context?.features?.includes('nursing') === true && userHasCapability(user, 'nursing.task.manage') && network?.canRead !== false;
  const canWrite = canRead && network?.isReadOnly !== true;
  const scope = hashQueryValue(JSON.stringify([fluidAccessScope(user, transport), canRead, canWrite, network?.networkDecision?.policy_version]));
  return { scope, canRead, canWrite, readonlyMessage: network?.readonlyMessage };
}
