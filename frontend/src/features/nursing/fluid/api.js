import { v2Api } from '@/lib/api/v2/client';
const validId = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
export function observation(value) {
  if (!validId(value?.id) || !validId(value?.root_entry_id) || !validId(value?.patient_id) || !validId(value?.admission_case_id)
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.current !== 'boolean'
    || !Number.isFinite(Date.parse(value.created_at)) || !Number.isFinite(Date.parse(value.values?.recorded_at)) || !integer(value.values?.intake_ml) || !integer(value.values?.output_ml)
    || !value.values.metadata || typeof value.values.metadata !== 'object') throw new Error('The fluid observation could not be confirmed.');
  return value;
}
function page(response, validate) {
  if (!Array.isArray(response?.data) || typeof response?.page?.has_next !== 'boolean'
    || response.data.length > 100 || (response.page.has_next && (typeof response.page.next_cursor !== 'string' || !response.page.next_cursor || response.data.length === 0))) throw new Error('The complete fluid page could not be confirmed.');
  return { rows: response.data.map(validate), next: response.page.has_next ? response.page.next_cursor : null };
}
export class FluidWriteUnconfirmedError extends Error {
  constructor() { super('This change may already be saved. Keep this request unchanged, refresh the observations and history, or retry this exact request.'); this.name = 'FluidWriteUnconfirmedError'; }
}
function uncertain(error) { return !error?.status || error.status >= 500 || (error?.data?.error?.code || error?.code || '').endsWith('_unconfirmed'); }
async function write(operation, validate) {
  try { return validate((await operation())?.data); } catch (error) { if (uncertain(error)) throw new FluidWriteUnconfirmedError(); throw error; }
}
function receipt(value, key, action, root) {
  if (value?.client_request_id !== key || value.action !== action || !validId(value.root_entry_id) || !validId(value.entry_id)
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.replayed !== 'boolean' || (root && value.root_entry_id !== root)) throw new FluidWriteUnconfirmedError();
  return value;
}
function settings(value) {
  if (!integer(value?.version) || typeof value.configured !== 'boolean' || value.configured !== (value.version > 0) || !value.values
    || !['min_daily_intake_target', 'max_daily_output_threshold', 'negative_balance_alert_threshold', 'positive_balance_alert_threshold'].every((key) => Number.isSafeInteger(value.values[key]))
    || !['enable_intake_alerts', 'enable_output_alerts', 'enable_balance_alerts'].every((key) => typeof value.values[key] === 'boolean')) throw new Error('The current fluid rules could not be confirmed.');
  return value;
}
export const fluidApi = {
  async list(query, { signal } = {}) {
    const response = await v2Api.getFluidObservations({ query, signal });
    return page(response, (value) => { const row = observation(value); if ((!row.current && !(query.include_closed && row.closed_by_action === 'voided')) || (query.patient_id && row.patient_id !== query.patient_id) || (query.admission_case_id && row.admission_case_id !== query.admission_case_id) || (query.recorded_from && Date.parse(row.values.recorded_at) < Date.parse(query.recorded_from)) || (query.recorded_before && Date.parse(row.values.recorded_at) >= Date.parse(query.recorded_before))) throw new Error('Fluid scope could not be confirmed.'); return row; });
  },
  async all(query, { signal } = {}) {
    const rows = []; const seen = new Set(); const seenIds = new Set(); let cursor;
    for (let pages = 0; pages < 100; pages += 1) {
      const result = await this.list({ ...query, limit: 100, ...(cursor ? { cursor } : {}) }, { signal }); for (const row of result.rows) { if (seenIds.has(row.id)) throw new Error('The fluid list could not be completed. Refresh before continuing.'); seenIds.add(row.id); rows.push(row); }
      if (!result.next) return rows;
      if (seen.has(result.next)) throw new Error('The fluid list could not be completed. Narrow the date range and retry.'); seen.add(result.next); cursor = result.next;
    }
    throw new Error('The fluid list is too large to complete. Narrow the date range.');
  },
  async get(id, { signal } = {}) { const row = observation((await v2Api.getFluidObservationById({ id }, { signal }))?.data); if (row.id !== id) throw new Error('The observation identity could not be confirmed.'); return row; },
  async history(id, cursor, { signal } = {}) { return page(await v2Api.getFluidObservationHistory({ id }, { query: { limit: 25, ...(cursor ? { cursor } : {}) }, signal }), observation); },
  async summary(query, { signal } = {}) {
    const value = (await v2Api.getFluidObservationSummary({ query, signal }))?.data;
    if (!integer(value?.entry_count) || !integer(value.total_intake_ml) || !integer(value.total_output_ml) || value.net_ml !== value.total_intake_ml - value.total_output_ml || !Array.isArray(value.intake_breakdown) || !Array.isArray(value.output_breakdown)) throw new Error('Complete fluid totals could not be confirmed.'); return value;
  },
  create(payload, { signal } = {}) { return write(() => v2Api.postFluidObservation(payload, { signal }), (v) => receipt(v, payload.client_request_id, 'created')); },
  correct(id, payload, root, { signal } = {}) { return write(() => v2Api.postFluidObservationCorrection({ id }, payload, { signal }), (v) => receipt(v, payload.client_request_id, 'corrected', root)); },
  void(id, payload, root, { signal } = {}) { return write(() => v2Api.postFluidObservationVoid({ id }, payload, { signal }), (v) => receipt(v, payload.client_request_id, 'voided', root)); },
  async rules({ signal } = {}) { return settings((await v2Api.getFluidMonitoringRules({ signal }))?.data); },
  updateRules(payload, { signal } = {}) { return write(() => v2Api.postFluidMonitoringRules(payload, { signal }), (v) => { const result = settings(v); if (result.version !== payload.expected_version + 1 || JSON.stringify(result.values) !== JSON.stringify(payload.values)) {
    // Field order is not part of the wire contract.
    if (result.version !== payload.expected_version + 1 || Object.keys(payload.values).some((key) => result.values[key] !== payload.values[key])) throw new FluidWriteUnconfirmedError();
  } return result; }); },
  async assessment(query, { signal } = {}) {
    const value = (await v2Api.getFluidMonitoringAssessment({ query, signal }))?.data;
    if (value?.admission_case_id !== query.admission_case_id || value.date !== query.date || !['unconfigured', 'disabled', 'no_data', 'assessed'].includes(value.status) || !Array.isArray(value.conditions) || value.conditions.length > 4 || !integer(value.entry_count) || !integer(value.total_intake_ml) || !integer(value.total_output_ml) || value.net_ml !== value.total_intake_ml - value.total_output_ml) throw new Error('Fluid monitoring could not be confirmed.'); if (value.conditions.some((condition) => !['low_intake', 'high_output', 'negative_balance', 'positive_balance'].includes(condition.kind) || !['warning', 'critical'].includes(condition.severity) || !Number.isSafeInteger(condition.value_ml) || !Number.isSafeInteger(condition.threshold_ml)) || (value.status !== 'assessed' && value.conditions.length > 0)) throw new Error('Fluid monitoring conditions could not be confirmed.'); settings(value.settings); return value;
  },
};
