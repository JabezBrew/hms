import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, assertWriteRecoveryReadCurrent, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { commandReceipt, locationPage, locationState, validId, validateCommand } from './model';
export class StorageLocationUnconfirmedError extends Error { constructor() { super('This location change may already be recorded. Check its original result or explicitly retry the unchanged reviewed request.'); this.name = 'StorageLocationUnconfirmedError'; } }
export const storageLocationApi = {
  async list(query = {}, { signal } = {}) { return locationPage(await v2Api.getStorageLocationAdministration({ query: { limit: 25, ...query }, signal })); },
  async get(id, { signal } = {}) { if (!validId(id)) throw new Error('Choose an exact storage location.'); return locationState((await v2Api.getStorageLocationAdministrationById({ id }, { signal })).data, id); },
  async write(command, { signal } = {}) {
    await validateCommand(command); const { action, location_id, ...body } = command.input; let response;
    try {
      response = action === 'create' ? await v2Api.postStorageLocationCreate(body, { signal }) : await ({ rename: v2Api.postStorageLocationRename, retire: v2Api.postStorageLocationRetire, reactivate: v2Api.postStorageLocationReactivate })[action]({ id: location_id }, body, { signal });
      const receipt = await commandReceipt(response?.data, { requestId: body.client_request_id, actorId: command.actorId, input: command.input, previous: command.previous }); acknowledgeWriteResponse(response); return receipt;
    } catch (error) { if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'storage_location_write_unconfirmed') throw error; markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new StorageLocationUnconfirmedError(), response || error); }
  },
  async recover(command, { signal } = {}) { await validateCommand(command); const response = await v2Api.getStorageLocationCommand({ client_request_id: command.input.client_request_id }, { signal }); const receipt = await commandReceipt(response?.data, { requestId: command.input.client_request_id, actorId: command.actorId, input: command.input, previous: command.previous }); assertWriteRecoveryReadCurrent(response); return receipt; },
  async original(requestId, actorId, { signal } = {}) { if (!validId(requestId) || !validId(actorId)) throw new Error('Choose an exact original storage location request.'); const response = await v2Api.getStorageLocationCommand({ client_request_id: requestId }, { signal }); const receipt = await commandReceipt(response?.data, { requestId, actorId }); assertWriteRecoveryReadCurrent(response); return receipt; },
};
