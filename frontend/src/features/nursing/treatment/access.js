import { userHasCapability } from '@/shared/lib/access';

export function canUseTreatmentCourses(user, full) {
  const context = user?.accessContext;
  return Boolean(full && context?.patient_visibility?.includes('full_clinical') && ['patients', 'encounters', 'nursing'].every((feature) => context?.features?.includes(feature))
    && userHasCapability(user, 'clinical_documentation.view'));
}
