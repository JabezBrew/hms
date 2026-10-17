import { createKeyFactory } from '@/shared/lib/queryKeys';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const keys = createKeyFactory('admission-advisories');
export const advisoryKeys = {
  patient: (scope, patientId) => [...keys.all, scope, hashQueryValue(patientId)],
  cases: (scope, patientId, query) => [...advisoryKeys.patient(scope, patientId), 'cases', hashQueryValue(JSON.stringify(query))],
  context: (scope, patientId, caseId) => [...advisoryKeys.patient(scope, patientId), 'context', hashQueryValue(caseId)],
  detail: (scope, patientId, caseId, id) => [...advisoryKeys.context(scope, patientId, caseId), 'detail', hashQueryValue(id)],
};
