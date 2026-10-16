import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { roundWorkspace, validateRoundReceipt } from './commandModel';

export const ROUND_ROOT = '/api/v2/patients/{patient_id}/chronicle/ward-rounds';
export class WardRoundUnconfirmedError extends Error {
  constructor() { super('This round change may already be saved. Check its original saved result or retry the exact reviewed request.'); this.name = 'WardRoundUnconfirmedError'; }
}
export const roundCommandApi = {
  async current(patientId, admissionId, { signal } = {}) {
    const response = await v2Api.getPatientChronicleCurrentWardRound({ patient_id: patientId }, { query: { admission_case_id: admissionId }, signal });
    return roundWorkspace(response?.data, { patientId, admissionId });
  },
  async write(command, { signal } = {}) {
    let response;
    try {
      response = command.kind === 'draft' ? await v2Api.postPatientChronicleWardRoundDraft({ patient_id: command.patientId }, command.wire, { signal }) : await v2Api.postPatientChronicleWardRoundCommit({ patient_id: command.patientId, round_id: command.roundId }, command.wire, { signal });
      const saved = validateRoundReceipt(response?.data, command); acknowledgeWriteResponse(response); return saved;
    } catch (error) {
      const code = error?.data?.error?.code || '';
      if (error?.status >= 400 && error.status < 500 && !/unconfirmed|write_uncertain/.test(code)) throw error;
      markWriteResponseUncertain(response || error);
      throw copyWriteResponseMetadata(new WardRoundUnconfirmedError(), response || error);
    }
  },
  async recover(command, { signal } = {}) {
    const response = await v2Api.getPatientChronicleWardRoundRequest({ patient_id: command.patientId, request_id: command.wire.client_request_id }, { signal });
    return validateRoundReceipt(response?.data, command);
  },
};
