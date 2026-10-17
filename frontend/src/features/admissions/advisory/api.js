import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { advisoryContext, advisoryDetail, advisoryReceipt, casePage } from './contracts';
export const ADVISORY_ROOT = '/api/v2/patients/{patient_id}/chronicle/admissions/{case_id}/advisories';
export class AdvisoryUnconfirmedError extends Error {
  constructor() { super('This follow-up change may already be recorded. Keep the request unchanged and check its original saved result.'); this.name = 'AdvisoryUnconfirmedError'; }
}
const pathParams = (scope) => ({ patient_id: scope.patientId, case_id: scope.caseId });
export const advisoryApi = {
  async cases(patientId, query, { signal } = {}) {
    return casePage(await v2Api.getPatientChronicleAdmissionAdvisoryCases({ patient_id: patientId }, { query, signal }), patientId, query);
  },
  async context(scope, { signal } = {}) { return advisoryContext((await v2Api.getPatientChronicleAdmissionAdvisories(pathParams(scope), { signal }))?.data, scope); },
  async detail(scope, id, { signal } = {}) { return advisoryDetail((await v2Api.getPatientChronicleAdmissionAdvisory({ ...pathParams(scope), advisory_id: id }, { signal }))?.data, { ...scope, id }); },
  async write(command, { signal } = {}) {
    let response;
    try {
      response = command.kind === 'create' ? await v2Api.postPatientChronicleAdmissionAdvisory(pathParams(command), command.payload, { signal }) : await v2Api.postPatientChronicleAdmissionAdvisoryDecision({ ...pathParams(command), advisory_id: command.source.id }, command.payload, { signal });
      const saved = advisoryReceipt(response?.data, command); acknowledgeWriteResponse(response); return saved;
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'admission_advisory_write_unconfirmed') throw error;
      markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new AdvisoryUnconfirmedError(), response || error);
    }
  },
  async recover(command, { signal } = {}) { return advisoryReceipt((await v2Api.getPatientChronicleAdmissionAdvisoryRequest({ ...pathParams(command), request_id: command.payload.client_request_id }, { signal }))?.data, command); },
};
