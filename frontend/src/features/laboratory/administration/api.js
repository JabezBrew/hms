import { v2Api } from '@/lib/api/v2/client';
import { currentNetworkPrincipal } from '@/lib/api/v2/networkAccessGuard';
import { assertWriteRecoveryReadCurrent, copyWriteResponseMetadata, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { catalogDetail, catalogPage, commandReceipt, historyPage, invalidEvidence, normalizeSearch, validId, validKind, validateCommand } from './model';
import { catalogOperations, commandWire } from './commandWire';
export class CatalogWriteUnconfirmed extends Error {
  constructor(cause) { super('This availability change may already be recorded. Check its original result before another change.', { cause }); this.name = 'CatalogWriteUnconfirmed'; }
}
const aborted = signal => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
const actor = id => { if (!validId(id) || currentNetworkPrincipal()?.id !== id) throw invalidEvidence(); };
const kindNames = { test: ['getLaboratoryTestAdministration', 'getLaboratoryTestAdministrationById', 'getLaboratoryTestHistory'], panel: ['getLaboratoryPanelAdministration', 'getLaboratoryPanelAdministrationById', 'getLaboratoryPanelHistory'] };
function params(kind, value, history = false) {
  const keys = history ? ['cursor', 'limit'] : ['cursor', 'limit', 'search', 'is_active', 'is_system_default', 'is_facility_modified', ...(kind === 'test' ? ['category'] : [])];
  if (!validKind(kind) || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalidEvidence();
  const fixed = { limit: 25, ...structuredClone(value) };
  if (!Number.isSafeInteger(fixed.limit) || fixed.limit < 1 || fixed.limit > 100 || (fixed.cursor !== undefined && (typeof fixed.cursor !== 'string' || !fixed.cursor))) throw invalidEvidence();
  for (const field of ['is_active', 'is_system_default', 'is_facility_modified']) if (Object.hasOwn(fixed, field) && typeof fixed[field] !== 'boolean') throw invalidEvidence();
  for (const field of ['search', 'category']) if (Object.hasOwn(fixed, field)) {
    if (typeof fixed[field] !== 'string') throw invalidEvidence();
    fixed[field] = normalizeSearch(fixed[field]);
  }
  return fixed;
}
export const laboratoryCatalogApi = {
  async list(kind, query = {}, { signal } = {}) {
    aborted(signal); const fixed = params(kind, query); await catalogOperations(); aborted(signal);
    const response = await v2Api[kindNames[kind][0]]({ query: fixed, signal }); aborted(signal); catalogPage(response); return { value: response, response };
  },
  async get(kind, id, { signal } = {}) {
    aborted(signal); if (!validKind(kind) || !validId(id)) throw invalidEvidence(); await catalogOperations(); aborted(signal);
    const response = await v2Api[kindNames[kind][1]]({ id }, { signal }); aborted(signal); return { value: catalogDetail(response?.data, kind, id), response };
  },
  async history(kind, id, query = {}, { signal } = {}) {
    aborted(signal); if (!validKind(kind) || !validId(id)) throw invalidEvidence(); const fixed = params(kind, query, true); await catalogOperations(); aborted(signal);
    const response = await v2Api[kindNames[kind][2]]({ id }, { query: fixed, signal }); aborted(signal); historyPage(response); return { value: response, response };
  },
  async write(command, { signal } = {}) {
    aborted(signal); const fixed = await validateCommand(command); const wire = await commandWire(fixed.input); aborted(signal); actor(fixed.actorId);
    let response;
    try {
      response = await v2Api[wire.operation](wire.pathParams, wire.body, { signal });
      const receipt = await commandReceipt(response?.data, { requestId: fixed.input.client_request_id, actorId: fixed.actorId, input: fixed.input, previous: fixed.previous });
      return { receipt, response };
    } catch (error) {
      const code = String(error?.data?.error?.code || '');
      if (!response && error?.status >= 400 && error.status < 500 && !/unconfirmed|write_uncertain/.test(code)) throw error;
      if (!response && error?.name === 'AbortError') throw error;
      const uncertain = copyWriteResponseMetadata(new CatalogWriteUnconfirmed(error), response || error);
      try { markWriteResponseUncertain(response || error); } catch { /* Retain the RAM intent and existing storage-fault barrier. */ }
      throw uncertain;
    }
  },
  async recover(command, { signal } = {}) {
    aborted(signal); const fixed = await validateCommand(command); return this.original(fixed.input.client_request_id, fixed.actorId, { signal, command: fixed });
  },
  async original(requestId, actorId, { signal, command = null } = {}) {
    aborted(signal); if (!validId(requestId)) throw invalidEvidence(); actor(actorId); await catalogOperations(); aborted(signal);
    const response = await v2Api.getLaboratoryCatalogCommandReceipt({ client_request_id: requestId }, { signal });
    const receipt = await commandReceipt(response?.data, { requestId, actorId, input: command?.input, previous: command?.previous });
    aborted(signal); assertWriteRecoveryReadCurrent(response); return { receipt, response };
  },
};
