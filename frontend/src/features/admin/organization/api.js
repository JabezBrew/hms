import { v2Api } from '@/lib/api/v2/client';
import { unitPage, unitState, validId, validateCommand, commandReceipt } from './model';
import { assertWriteRecoveryReadCurrent, acknowledgeWriteResponse, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';

export const organizationApi = {
  async list(query = {}, { signal } = {}) { return unitPage(await v2Api.getAdminOrgUnits({ query: { limit: 25, ...query }, signal })); },
  async get(id, { signal } = {}) { if (!validId(id)) throw new Error('Choose an exact organization unit.'); return unitState((await v2Api.getAdminOrgUnitById({ id }, { signal })).data, id); },
  async children(id, query = {}, { signal } = {}) { if (!validId(id)) throw new Error('Choose an exact organization unit.'); const result = unitPage(await v2Api.getAdminOrgUnitChildren({ id }, { query: { limit: 25, ...query }, signal })); if (result.data.some(unit => unit.parent_unit_id !== id)) throw new Error('Current child units could not be confirmed.'); return result; },
};

export class OrganizationUnconfirmedError extends Error {
  constructor() { super('This organization change may already be recorded. Check its original result or explicitly retry the unchanged reviewed request.'); this.name = 'OrganizationUnconfirmedError'; }
}
organizationApi.write = async (command, { signal } = {}) => {
  await validateCommand(command); const { action, unit_id, ...body } = command.input; let response;
  try {
    if (action === 'create') response = await v2Api.postAdminOrgUnits(body, { signal });
    else response = await ({ rename: v2Api.postAdminOrgUnitRename, retire: v2Api.postAdminOrgUnitRetire, reactivate: v2Api.postAdminOrgUnitReactivate })[action]({ id: unit_id }, body, { signal });
    const receipt = await commandReceipt(response?.data, { requestId: body.client_request_id, actorId: command.actorId, input: command.input, previous: command.previous }); acknowledgeWriteResponse(response); return receipt;
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'organization_unit_write_unconfirmed') throw error;
    markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new OrganizationUnconfirmedError(), response || error);
  }
};
organizationApi.recover = async (command, { signal } = {}) => {
  await validateCommand(command);
  const response = await v2Api.getAdminOrgUnitCommand({ client_request_id: command.input.client_request_id }, { signal });
  const receipt = await commandReceipt(response?.data, { requestId: command.input.client_request_id, actorId: command.actorId, input: command.input, previous: command.previous });
  assertWriteRecoveryReadCurrent(response); return receipt;
};

organizationApi.original = async (requestId, actorId, { signal } = {}) => {
  const response = await v2Api.getAdminOrgUnitCommand({ client_request_id: requestId }, { signal });
  const receipt = await commandReceipt(response?.data, { requestId, actorId });
  assertWriteRecoveryReadCurrent(response); return receipt;
};
