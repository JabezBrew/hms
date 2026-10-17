import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { destinationQuery, historyQuery, moveDetail, movePage, moveReceipt, moveScope, placementContext, validId, validateMoveCommand } from './model';
export class AdmissionMoveUnconfirmedError extends Error {
  constructor() { super('The move may already be recorded. Check its original saved result or explicitly retry the unchanged reviewed move.'); this.name = 'AdmissionMoveUnconfirmedError'; }
}
export const admissionMoveApi = {
  async context(scope, { signal } = {}) { return placementContext((await v2Api.getAdmissionPlacementContext(moveScope(scope), { signal }))?.data, scope); },
  async destinations(scope, query = {}, { signal } = {}) { query = destinationQuery(query); return movePage(await v2Api.getAdmissionMoveDestinations(moveScope(scope), { query, signal }), scope, query, 'destinations'); },
  async history(scope, query = {}, { signal } = {}) { query = historyQuery(query); return movePage(await v2Api.getAdmissionMoveHistory(moveScope(scope), { query, signal }), scope, query, 'history'); },
  async detail(scope, id, { signal } = {}) { if (!validId(id)) throw new Error('Choose one exact recorded move.'); return moveDetail((await v2Api.getAdmissionMove({ ...moveScope(scope), move_id: id }, { signal }))?.data, scope, id); },
  async write(command, { signal } = {}) {
    validateMoveCommand(command);
    let response;
    try { response = await v2Api.postAdmissionMove(moveScope(command), command.payload, { signal }); const receipt = moveReceipt(response?.data, command); acknowledgeWriteResponse(response); return receipt; }
    catch (error) { if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'admission_move_write_unconfirmed') throw error; markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new AdmissionMoveUnconfirmedError(), response || error); }
  },
  async recover(command, { signal } = {}) { validateMoveCommand(command); return moveReceipt((await v2Api.getAdmissionMoveRequestReceipt({ ...moveScope(command), request_id: command.payload.client_request_id }, { signal }))?.data, command); },
};
