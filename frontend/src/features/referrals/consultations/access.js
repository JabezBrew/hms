import { userHasCapability } from '@/shared/lib/access';
export function consultationPermission(user, clinical, preparationOnly = false) {
  const context = user?.accessContext;
  const canRead = Boolean((preparationOnly || clinical?.can_view_full_clinical) && context?.patient_visibility?.includes('full_clinical') && ['patients', 'referrals', 'encounters'].every(feature => context?.features?.includes(feature)) && userHasCapability(user, 'patient.demographics.view') && userHasCapability(user, 'encounter.view'));
  return { canRead, canManage: canRead && userHasCapability(user, 'referral.manage') && userHasCapability(user, 'encounter.manage') };
}
