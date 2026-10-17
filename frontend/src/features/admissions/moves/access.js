import { userHasCapability } from '@/shared/lib/access';
export function canUseAdmissionMoves(user, full) {
  const context = user?.accessContext;
  return Boolean(full && context?.patient_visibility?.includes('full_clinical') && ['patients', 'admissions'].every(feature => context?.features?.includes(feature))
    && userHasCapability(user, 'admission.manage') && userHasCapability(user, 'patient.demographics.view'));
}
