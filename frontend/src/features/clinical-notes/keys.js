import { createKeyFactory } from '@/shared/lib/queryKeys';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const root = createKeyFactory('clinical-note-workspace');
export const noteKeys = {
  all: root.all,
  patient: (scope, patientId) => [...root.all, scope, hashQueryValue(patientId)],
  detail: (scope, patientId, id) => [...noteKeys.patient(scope, patientId), 'detail', hashQueryValue(id)],
  history: (scope, patientId, id, cursor) => [...noteKeys.detail(scope, patientId, id), 'history', hashQueryValue(cursor || '')],
  version: (scope, patientId, id, versionId) => [...noteKeys.detail(scope, patientId, id), 'version', hashQueryValue(versionId)],
  templates: (scope) => [...root.all, scope, 'templates'],
  catalog: (scope, query) => [...noteKeys.templates(scope), 'list', hashQueryValue(JSON.stringify(query))],
  template: (scope, id) => [...noteKeys.templates(scope), 'detail', hashQueryValue(id)],
  templateHistory: (scope, id, cursor) => [...noteKeys.template(scope, id), 'history', hashQueryValue(cursor || '')],
  templateVersion: (scope, id, versionId) => [...noteKeys.template(scope, id), 'version', hashQueryValue(versionId)],
};
