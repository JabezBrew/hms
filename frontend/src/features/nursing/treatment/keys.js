import { hashQueryValue } from '@/shared/lib/privateQueryKey';

const privatePart = (value) => hashQueryValue(JSON.stringify(value ?? null));
export const treatmentKeys = {
  all: ['admission-medication-courses'],
  admission: (scope, patientId, caseId) => [...treatmentKeys.all, scope, privatePart([patientId, caseId])],
  context: (scope, patientId, caseId, view = 'open') => [...treatmentKeys.admission(scope, patientId, caseId), 'context', view],
  list: (scope, patientId, caseId, query) => [...treatmentKeys.admission(scope, patientId, caseId), 'list', privatePart(query)],
  detail: (scope, patientId, caseId, courseId) => [...treatmentKeys.admission(scope, patientId, caseId), 'detail', privatePart(courseId)],
  doses: (scope, patientId, caseId, courseId, query) => [...treatmentKeys.detail(scope, patientId, caseId, courseId), 'doses', privatePart(query)],
  supply: (scope, patientId, caseId, courseId, query) => [...treatmentKeys.detail(scope, patientId, caseId, courseId), 'supply', privatePart(query)],
};
