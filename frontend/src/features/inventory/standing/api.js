import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';

function safeLines(items, quantityKey = 'quantity') {
  return Array.isArray(items) && items.length > 0 && items.length <= 100
    && items.every((item) => item.item_id && typeof item.unit === 'string' && Number.isSafeInteger(item[quantityKey]) && item[quantityKey] > 0);
}
function detail(envelope, id) {
  const value = envelope?.data;
  if (!value?.id || (id && value.id !== id) || !value.name || !Number.isSafeInteger(value.version) || value.version < 1
    || !['active', 'paused', 'cancelled'].includes(value.status) || !safeLines(value.items)) throw new Error('The response did not confirm the saved standing template.');
  return value;
}
function matchingConfiguration(value, input) {
  const lines = new Map(value.items.map((item) => [item.item_id, item]));
  return value.name === input.name.trim() && value.requesting_location_id === input.requesting_location_id
    && value.fulfilling_location_id === input.fulfilling_location_id && value.frequency === input.frequency
    && value.next_run_on === input.next_run_on && (value.monthly_day ?? null) === (input.monthly_day ?? null)
    && (value.notes?.trim() || null) === (input.notes?.trim() || null) && value.items.length === input.items.length
    && input.items.every((item) => lines.get(item.item_id)?.quantity === item.quantity && lines.get(item.item_id)?.unit === item.expected_unit);
}
function review(envelope, id, occurrence) {
  const value = envelope?.data;
  if (!value?.id || (id && value.source_template_id !== id) || (occurrence && value.scheduled_for !== occurrence)
    || !safeLines(value.items, 'quantity_requested') || !value.status
    || value.items.some((item) => !Number.isSafeInteger(item.quantity_issued) || item.quantity_issued < 0 || item.quantity_issued > item.quantity_requested)) {
    throw new Error('The response did not confirm the line-backed request.');
  }
  return value;
}
async function write(operation, validate) {
  let response;
  try { response = await operation(); const saved = validate(response); acknowledgeWriteResponse(response); return saved; }
  catch (error) {
    const code = error.data?.error?.code || error.code || '';
    if (!error.status || error.status >= 500 || code.endsWith('_unconfirmed')) {
      markWriteResponseUncertain(response || error);
      const unknown = new Error('This change may already be saved. Close and review the refreshed templates and requests before making another change.');
      unknown.code = 'standing_write_unconfirmed'; unknown.status = error.status;
      throw unknown;
    }
    throw error;
  }
}
export const standingApi = {
  async list(query, { signal } = {}) {
    const response = await v2Api.getInventoryStandingTemplates({ query, signal });
    if (!Array.isArray(response?.data) || !response?.page) throw new Error('Standing templates could not be confirmed.');
    return response;
  },
  async get(id, { signal } = {}) { return detail(await v2Api.getInventoryStandingTemplateById({ id }, { signal }), id); },
  async create(payload) {
    return write(() => v2Api.postInventoryStandingTemplates(payload), (response) => {
      const value = detail(response);
      if (value.status !== 'active' || !matchingConfiguration(value, payload)) throw new Error('The saved template did not confirm the requested configuration.');
      return value;
    });
  },
  async update(id, payload) {
    return write(() => v2Api.patchInventoryStandingTemplate({ id }, payload), (response) => {
      const value = detail(response, id);
      if (value.version !== payload.expected_version + 1 || !matchingConfiguration(value, payload.template)) throw new Error('The updated template did not confirm the requested configuration.');
      return value;
    });
  },
  async status(id, payload) {
    return write(() => v2Api.postInventoryStandingTemplateStatus({ id }, payload), (response) => {
      const value = detail(response, id);
      if (value.status !== payload.status) throw new Error('The requested template status was not confirmed.');
      return value;
    });
  },
  async run(id, payload) {
    return write(() => v2Api.postInventoryStandingTemplateRun({ id }, payload), (response) => {
      const value = review(response, id, payload.scheduled_for);
      if (value.template_version !== payload.expected_version) throw new Error('The source template version was not confirmed.');
      return value;
    });
  },
  async approve(id, payload) {
    return write(() => v2Api.postInventoryRequisitionApprove({ id }, payload), (response) => {
      const value = review(response);
      if (value.id !== id || value.template_version !== payload.expected_source_version || value.status !== 'approved' || !value.approved_at || value.items.some((item) => item.quantity_issued !== 0)) throw new Error('Request approval was not confirmed.');
      return value;
    });
  },
  async issue(id, payload) {
    return write(() => v2Api.postInventoryRequisitionIssue({ id }, payload), (response) => {
      const value = review(response);
      if (value.id !== id || value.template_version !== payload.expected_source_version || value.status !== 'fulfilled' || !value.fulfilled_at || value.items.some((item) => item.quantity_issued !== item.quantity_requested)) throw new Error('The stock issue was not confirmed.');
      return value;
    });
  },
  async cancel(id, payload) {
    return write(() => v2Api.postInventoryRequisitionCancel({ id }, payload), (response) => {
      const value = review(response);
      if (value.id !== id || value.template_version !== payload.expected_source_version || value.status !== 'cancelled' || !value.cancelled_at || value.items.some((item) => item.quantity_issued !== 0)) throw new Error('Request cancellation was not confirmed.');
      return value;
    });
  },
  async review(id, { signal } = {}) {
    const value = review(await v2Api.getInventoryRequisitionReview({ id }, { signal }));
    if (value.id !== id) throw new Error('The request identity could not be confirmed.');
    return value;
  },
  async choices(kind, query, { signal } = {}) {
    const response = kind === 'items' ? await v2Api.getInventoryItems({ query: { ...query, status: 'active' }, signal }) : await v2Api.getStorageLocations({ query, signal });
    if (!Array.isArray(response?.data) || !response?.page) throw new Error('Facility choices could not be loaded.');
    return response;
  },
};
