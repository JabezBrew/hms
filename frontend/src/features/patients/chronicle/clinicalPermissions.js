import { createContext, useContext } from 'react';
import { AuthContext } from '@/lib/auth/AuthContext';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { userHasCapability } from '@/shared/lib/access';

export const ChronicleClinicalPermissionsContext = createContext(null);
const flags = ['can_view_full_clinical', 'can_add_note', 'can_record_vitals', 'can_prescribe'];
export function chronicleClinicalPermissions(context, rustV2) {
  const full = !rustV2 || context?.permissions?.can_view_full_clinical === true;
  return Object.fromEntries(flags.map((flag) => [flag, full && (!rustV2 || context?.permissions?.[flag] === true)]));
}
// A mounted Chronicle uses its patient-authorized server facts. Standalone
// consumers retain the existing authenticated data-class/capability guard; their
// detail endpoint remains authoritative before any full clinical content loads.
export function useChronicleClinicalPermissions() {
  const inherited = useContext(ChronicleClinicalPermissionsContext);
  const user = useContext(AuthContext)?.user;
  if (inherited) return inherited;
  if (!isRustV2ApiMode()) return chronicleClinicalPermissions(null, false);
  const full = user?.accessContext?.patient_visibility?.includes('full_clinical') === true;
  return { can_view_full_clinical: full, can_add_note: full && userHasCapability(user, 'clinical_documentation.manage'), can_record_vitals: full && userHasCapability(user, 'nursing.task.manage'), can_prescribe: full && userHasCapability(user, 'clinical_documentation.manage') };
}
