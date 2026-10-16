import { useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { userHasCapability } from '@/shared/lib/access';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { useChronicleClinicalPermissions } from '@/features/patients/chronicle/clinicalPermissions';

export function useNoteAccess() {
  const { user } = useAuth(); const permissions = useChronicleClinicalPermissions(); const access = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const feature = user?.accessContext?.features?.includes('encounters') === true;
  const manage = userHasCapability(user, 'clinical_documentation.manage');
  const canReadTemplates = feature && (userHasCapability(user, 'clinical_documentation.view') || userHasCapability(user, 'clinical_documentation.manage'));
  const canRead = feature && user?.accessContext?.patient_visibility?.includes('full_clinical') === true && permissions.can_view_full_clinical && (userHasCapability(user, 'clinical_documentation.view') || manage);
  const canWrite = canRead && manage && permissions.can_add_note && access?.isReadOnly !== true;
  const canManageTemplates = feature && manage && access?.isReadOnly !== true;
  const scope = hashQueryValue(JSON.stringify([authorizationScope(user, transport), canRead, canWrite, canManageTemplates, access?.networkDecision?.policy_version]));
  return { user, scope, canRead, canWrite, canReadTemplates, canManageTemplates, readonlyMessage: access?.readonlyMessage };
}
