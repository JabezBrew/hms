import { hashQueryValue } from '@/shared/lib/privateQueryKey';
const privatePart = value => hashQueryValue(JSON.stringify(value));
export const moveKeys = {
  all: ['admission-moves'],
  admission: (proof, patientId, caseId) => [...moveKeys.all, proof, privatePart([patientId, caseId])],
  context: (proof, patientId, caseId, view) => [...moveKeys.admission(proof, patientId, caseId), 'placement', view],
  destinations: (proof, patientId, caseId, token, query) => [...moveKeys.admission(proof, patientId, caseId), 'destinations', privatePart([token, query])],
  history: (proof, patientId, caseId, query) => [...moveKeys.admission(proof, patientId, caseId), 'history', privatePart(query)],
  detail: (proof, patientId, caseId, id) => [...moveKeys.admission(proof, patientId, caseId), 'move', privatePart(id)],
};
