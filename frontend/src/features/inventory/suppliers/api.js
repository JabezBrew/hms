import { v2Api } from '@/lib/api/v2/client';
import { currentNetworkPrincipal } from '@/lib/api/v2/networkAccessGuard';
import { assertWriteRecoveryReadCurrent, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { commandReceipt, historyPage, invalidEvidence, supplierDetail, supplierPage, validId, validateCommand } from './model';
import { commandWire } from './commandWire';
export class InventorySupplierUnconfirmedError extends Error { constructor(cause) { super('This supplier change may already be recorded. Check the original result or explicitly retry the unchanged reviewed request.', { cause }); this.name = 'InventorySupplierUnconfirmedError'; } }
const aborted = signal => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
const actor = value => { if (!validId(value) || currentNetworkPrincipal()?.id !== value) throw invalidEvidence(); };
const queryCopy = (query, fields, limit) => {
  const allowed = new Set(fields);
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !allowed.has(key))) throw invalidEvidence();
  return { limit, ...structuredClone(query) };
};
function unknown(error, response) {
  const failure = copyWriteResponseMetadata(new InventorySupplierUnconfirmedError(error), response || error);
  try { markWriteResponseUncertain(response || error); } catch { /* Existing storage-fault barrier remains authoritative; retain the exact RAM intent. */ }
  return failure;
}
export const inventorySupplierApi = {
  async list(query = {}, { signal } = {}) {
    aborted(signal); const params = queryCopy(query, ['cursor', 'limit', 'search', 'is_active'], 25);
    const response = await v2Api.getInventorySupplierAdministration({ query: params, signal }); aborted(signal); supplierPage(response);
    return { value: response, response };
  },
  async get(id, { signal } = {}) {
    aborted(signal); if (!validId(id)) throw invalidEvidence();
    const response = await v2Api.getInventorySupplierAdministrationById({ id }, { signal }); aborted(signal);
    return { value: supplierDetail(response?.data, id), response };
  },
  async history(id, query = {}, { signal } = {}) {
    aborted(signal); if (!validId(id)) throw invalidEvidence(); const params = queryCopy(query, ['cursor', 'limit'], 25);
    const response = await v2Api.getInventorySupplierHistory({ id }, { query: params, signal }); aborted(signal); historyPage(response);
    return { value: response, response };
  },
  async write(command, { signal } = {}) {
    aborted(signal); const fixed = await validateCommand(command); aborted(signal); actor(fixed.actorId);
    const wire = commandWire(fixed.input); let response;
    try {
      response = wire.pathParams ? await v2Api[wire.operation](wire.pathParams, wire.body, { signal }) : await v2Api[wire.operation](wire.body, { signal });
      const receipt = await commandReceipt(response?.data, { requestId: fixed.input.client_request_id, actorId: fixed.actorId, input: fixed.input, previous: fixed.previous });
      // Keep the actual envelope. The controller must apply its current lease
      // and final live read/ACK rules; a typed copy is never a transport proof.
      return { receipt, response };
    } catch (error) {
      if (!response && error?.status >= 400 && error.status < 500 && !String(error.data?.error?.code || '').endsWith('_unconfirmed')) throw error;
      if (!response && error?.name === 'AbortError') throw error;
      throw unknown(error, response);
    }
  },
  async recover(command, { signal } = {}) {
    aborted(signal); const fixed = await validateCommand(command); aborted(signal); actor(fixed.actorId);
    const response = await v2Api.getInventorySupplierCommandReceipt({ client_request_id: fixed.input.client_request_id }, { signal });
    const receipt = await commandReceipt(response?.data, { requestId: fixed.input.client_request_id, actorId: fixed.actorId, input: fixed.input, previous: fixed.previous });
    aborted(signal); assertWriteRecoveryReadCurrent(response); return { receipt, response };
  },
  async original(requestId, actorId, { signal } = {}) {
    aborted(signal); if (!validId(requestId)) throw invalidEvidence(); actor(actorId);
    const response = await v2Api.getInventorySupplierCommandReceipt({ client_request_id: requestId }, { signal });
    const receipt = await commandReceipt(response?.data, { requestId, actorId });
    aborted(signal); assertWriteRecoveryReadCurrent(response); return { receipt, response };
  },
};
