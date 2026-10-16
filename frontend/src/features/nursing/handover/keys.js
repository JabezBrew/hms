import { createKeyFactory } from '@/shared/lib/queryKeys';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const keys = createKeyFactory('patient-handovers');
export const handoverKeys = {
  patient: (scope, patientId) => [...keys.all, scope, hashQueryValue(patientId)],
  list: (scope, patientId, query) => [...handoverKeys.patient(scope, patientId), 'list', hashQueryValue(JSON.stringify(query))],
  detail: (scope, patientId, rootId) => [...handoverKeys.patient(scope, patientId), 'detail', hashQueryValue(rootId)],
  history: (scope, patientId, rootId, cursor) => [...handoverKeys.patient(scope, patientId), 'history', hashQueryValue(rootId), hashQueryValue(cursor || '')],
  revision: (scope, patientId, rootId, revisionId) => [...handoverKeys.patient(scope, patientId), 'revision', hashQueryValue(rootId), hashQueryValue(revisionId)],
  recipients: (scope, patientId, query) => [...handoverKeys.patient(scope, patientId), 'recipients', hashQueryValue(JSON.stringify(query))],
};
