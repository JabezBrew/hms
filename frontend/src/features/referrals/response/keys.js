import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const privatePart = value => hashQueryValue(JSON.stringify(value));
export const responseKeys = {
  all: ['referral-responses'],
  referral: (scope, patientId, referralId) => [...responseKeys.all, scope, privatePart([patientId, referralId])],
  context: (scope, patientId, referralId, view = 'open') => [...responseKeys.referral(scope, patientId, referralId), 'context', view],
  history: (scope, patientId, referralId, query) => [...responseKeys.referral(scope, patientId, referralId), 'history', privatePart(query)],
  version: (scope, patientId, referralId, versionId) => [...responseKeys.referral(scope, patientId, referralId), 'version', privatePart(versionId)],
};
