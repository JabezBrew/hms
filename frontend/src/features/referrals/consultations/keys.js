import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const root = (proof, scope) => ['referral-consultation', proof, hashQueryValue(scope.patientId), hashQueryValue(scope.referralId)];
export const consultationKeys = { referral: root, context: (proof, scope, source) => [...root(proof, scope), 'context', hashQueryValue(JSON.stringify(source))] };
