import { userHasCapability } from '@/shared/lib/access';
export function canUseAdmissionAdvisories(user, full) {
  const context = user?.accessContext;
  return Boolean(full && context?.patient_visibility?.includes('full_clinical') && ['patients', 'encounters', 'admissions'].every((key) => context?.features?.includes(key))
    && userHasCapability(user, 'admission.manage') && (userHasCapability(user, 'clinical_documentation.view') || userHasCapability(user, 'clinical_documentation.manage')));
}
