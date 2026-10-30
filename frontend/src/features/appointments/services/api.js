import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, assertWriteRecoveryReadCurrent, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { commandReceipt, servicePage, serviceState, validId, validateCommand } from './model';
export class ServiceUnconfirmedError extends Error { constructor() { super('This service change may already be recorded. Check its original result or explicitly retry the unchanged reviewed request.'); this.name = 'ServiceUnconfirmedError'; } }
const commandCopy = value => structuredClone({ input: value?.input, actorId: value?.actorId, previous: value?.previous, digest: value?.digest });
export const serviceApi = {
  async list(query = {}, { signal } = {}) { return servicePage(await v2Api.getAppointmentTypeAdministration({ query: { limit: 25, ...query }, signal })); },
  async get(id, { signal } = {}) { if (!validId(id)) throw new Error('Choose an exact bookable service.'); return serviceState((await v2Api.getAppointmentTypeAdministrationById({ id }, { signal })).data, id); },
  async write(command, { signal } = {}) {
    command = commandCopy(command);
    await validateCommand(command); const { action, service_id, ...body } = command.input; let response;
    try {
      response = action === 'create' ? await v2Api.postAppointmentTypeCreate(body, { signal }) : await ({ metadata: v2Api.postAppointmentTypeMetadata, retire: v2Api.postAppointmentTypeRetire, reactivate: v2Api.postAppointmentTypeReactivate })[action]({ id: service_id }, body, { signal });
      const receipt = await commandReceipt(response?.data, { requestId: body.client_request_id, actorId: command.actorId, input: command.input, previous: command.previous }); acknowledgeWriteResponse(response); return receipt;
    } catch (error) { if (error.status >= 400 && error.status < 500 && error.data?.error?.code !== 'appointment_type_write_unconfirmed') throw error; markWriteResponseUncertain(response || error); throw copyWriteResponseMetadata(new ServiceUnconfirmedError(), response || error); }
  },
  async recover(command, { signal } = {}) { command = commandCopy(command); await validateCommand(command); const response = await v2Api.getAppointmentTypeCommand({ client_request_id: command.input.client_request_id }, { signal }); const receipt = await commandReceipt(response?.data, { requestId: command.input.client_request_id, actorId: command.actorId, input: command.input, previous: command.previous }); assertWriteRecoveryReadCurrent(response); return receipt; },
  async original(requestId, actorId, { signal } = {}) { if (!validId(requestId) || !validId(actorId)) throw new Error('Choose an exact original service request.'); const response = await v2Api.getAppointmentTypeCommand({ client_request_id: requestId }, { signal }); const receipt = await commandReceipt(response?.data, { requestId, actorId }); assertWriteRecoveryReadCurrent(response); return receipt; },
};
