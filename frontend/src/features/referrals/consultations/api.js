import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { consultationScope, consultationContext, contextQuery, startReceipt, validateCommand } from './model';
export class ConsultationUnconfirmedError extends Error { constructor() { super('The consultation start may already be recorded. Check its original result or explicitly retry the unchanged reviewed start.'); this.name = 'ConsultationUnconfirmedError'; } }
export const consultationApi = {
  async context(scope, selection = null, { signal } = {}) { return consultationContext((await v2Api.getReferralConsultationContext(consultationScope(scope), { query: contextQuery(selection), signal }))?.data, scope, selection); },
  async write(command, { signal } = {}) {
    await validateCommand(command); let response;
    try { response = await v2Api.startReferralConsultation(consultationScope(command), command.payload, { signal }); const receipt = await startReceipt(response?.data, command); acknowledgeWriteResponse(response); return receipt; }
    catch (error) { if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'referral_consultation_write_unconfirmed') throw error; markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new ConsultationUnconfirmedError(), response || error); }
  },
  async recover(command, { signal } = {}) { await validateCommand(command); return startReceipt((await v2Api.getReferralConsultationRequestReceipt({ ...consultationScope(command), request_id: command.payload.client_request_id }, { signal }))?.data, command); },
};
