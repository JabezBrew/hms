import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { historyQuery, responseContext, responsePage, responseReceipt, responseRevision, responseScope, validId } from './model';
export class ReferralResponseUnconfirmedError extends Error {
  constructor() { super('This referral response may already be recorded. Keep the reviewed request unchanged and check its original saved result.'); this.name = 'ReferralResponseUnconfirmedError'; }
}
export const referralResponseApi = {
  async context(scope, { signal } = {}) { return responseContext((await v2Api.getReferralResponseContext(responseScope(scope), { signal }))?.data, scope); },
  async history(scope, query = {}, { signal } = {}) { query = historyQuery(query); return responsePage(await v2Api.getReferralResponseHistory(responseScope(scope), { query, signal }), scope, query); },
  async version(scope, versionId, { signal } = {}) {
    if (!validId(versionId)) throw new Error('Choose one exact saved response revision.');
    return responseRevision((await v2Api.getReferralResponseVersion({ ...responseScope(scope), version_id: versionId }, { signal }))?.data, scope, versionId);
  },
  async write(command, { signal } = {}) {
    let response;
    try {
      response = await v2Api.postReferralResponseCommand(responseScope(command), command.payload, { signal });
      const receipt = responseReceipt(response?.data, command); acknowledgeWriteResponse(response); return receipt;
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'referral_response_write_unconfirmed') throw error;
      markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new ReferralResponseUnconfirmedError(), response || error);
    }
  },
  async recover(command, { signal } = {}) {
    return responseReceipt((await v2Api.getReferralResponseRequestReceipt({ ...responseScope(command), request_id: command.payload.client_request_id }, { signal }))?.data, command);
  },
};
