const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = value => typeof value === 'string' && UUID.test(value) && value !== '00000000-0000-0000-0000-000000000000';
export const LOCATION_TYPES = { store: 'Store', pharmacy: 'Pharmacy', ward: 'Ward', warehouse: 'Warehouse', department: 'Department' };
export const TEMPERATURE_ZONES = { ambient: 'Ambient', cold: 'Cold storage', frozen: 'Frozen storage', controlled: 'Controlled' };
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const invalid = () => new Error('Current storage location evidence could not be confirmed. Refresh before continuing.');
export function locationState(value, id = null) {
  if (!validId(value?.id) || (id !== null && value.id !== id) || !text(value.code) || !text(value.name) || !text(value.location_type) || !text(value.temperature_zone) || typeof value.is_active !== 'boolean' || !Number.isSafeInteger(value.version) || value.version < 1 || !date(value.created_at) || !date(value.updated_at)) throw invalid();
  return value;
}
export function locationPage(value) {
  const page = value?.page;
  if (!Array.isArray(value?.data) || !page || typeof page.has_next !== 'boolean' || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100 || value.data.length > page.limit || (page.has_next ? !text(page.next_cursor) : page.next_cursor !== null)) throw invalid();
  value.data.forEach(row => locationState(row));
  if (new Set(value.data.map(row => row.id)).size !== value.data.length) throw invalid();
  return value;
}

export const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
export async function inputDigest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const bytes = value => new TextEncoder().encode(value).length;
export const validName = value => text(value) && value.trim() === value && bytes(value) <= 160 && ![...value].some(char => { const code = char.codePointAt(0); return code < 32 || (code >= 127 && code <= 159); });
export function reviewedInput(value) {
  const base = ['action', 'client_request_id'];
  if (!validId(value?.client_request_id)) throw invalid();
  if (value.action === 'create') {
    if (!exact(value, [...base, 'code', 'name', 'location_type', 'temperature_zone']) || !/^[A-Za-z0-9_-]{1,48}$/.test(value.code) || !validName(value.name) || !Object.hasOwn(LOCATION_TYPES, value.location_type) || !Object.hasOwn(TEMPERATURE_ZONES, value.temperature_zone)) throw invalid();
  } else if (['rename', 'retire', 'reactivate'].includes(value.action)) {
    if (!exact(value, [...base, 'location_id', 'expected_version', ...(value.action === 'rename' ? ['name'] : [])]) || !validId(value.location_id) || !Number.isSafeInteger(value.expected_version) || value.expected_version < 1 || (value.action === 'rename' && !validName(value.name))) throw invalid();
  } else throw invalid();
  return value;
}
export async function commandReceipt(value, { requestId, actorId, input = null, previous = null } = {}) {
  // A private value copy prevents asynchronous hashing from certifying an object
  // changed by another consumer while its digest was pending.
  const receipt = structuredClone(value ?? null);
  if (!exact(receipt, ['client_request_id', 'input_digest', 'reviewed_input', 'recorded_by_user_id', 'location', 'changed', 'recorded_at']) || !validId(requestId) || !validId(actorId) || receipt.client_request_id !== requestId || receipt.recorded_by_user_id !== actorId || !/^[0-9a-f]{64}$/.test(receipt.input_digest) || typeof receipt.changed !== 'boolean' || !date(receipt.recorded_at)) throw invalid();
  const command = reviewedInput(receipt.reviewed_input), unit = locationState(receipt.location);
  if (command.client_request_id !== requestId || (input && !same(command, reviewedInput(input)))) throw invalid();
  if (command.action === 'create') {
    if (!receipt.changed || unit.version !== 1 || unit.code !== command.code || unit.name !== command.name || unit.location_type !== command.location_type || unit.temperature_zone !== command.temperature_zone || !unit.is_active || unit.created_at !== unit.updated_at) throw invalid();
  } else {
    if (unit.id !== command.location_id || unit.version !== command.expected_version + (receipt.changed ? 1 : 0) || (command.action === 'rename' && unit.name !== command.name) || (command.action === 'retire' && unit.is_active) || (command.action === 'reactivate' && !unit.is_active)) throw invalid();
    if (previous) {
      locationState(previous, command.location_id);
      if (previous.version !== command.expected_version || unit.code !== previous.code || unit.location_type !== previous.location_type || unit.temperature_zone !== previous.temperature_zone || unit.created_at !== previous.created_at || (command.action === 'rename' ? unit.is_active !== previous.is_active : unit.name !== previous.name) || receipt.changed !== (unit.name !== previous.name || unit.is_active !== previous.is_active)) throw invalid();
    }
  }
  if (await inputDigest(command) !== receipt.input_digest) throw invalid();
  return receipt;
}
export async function prepareCommand(input, actorId, previous = null) {
  reviewedInput(input); if (!validId(actorId)) throw invalid();
  if (input.action !== 'create' && (!previous || locationState(previous, input.location_id).version !== input.expected_version)) throw invalid();
  return { input: structuredClone(input), actorId, previous: previous ? structuredClone(previous) : null, digest: await inputDigest(input) };
}
export async function validateCommand(command) {
  reviewedInput(command?.input); if (!validId(command.actorId) || command.digest !== await inputDigest(command.input)) throw invalid();
  if (command.input.action !== 'create' && (!command.previous || locationState(command.previous, command.input.location_id).version !== command.input.expected_version)) throw invalid();
  return command;
}
export const errorCopy = error => ({
  storage_location_has_operational_history: 'This location has recorded stock or operational history. This workflow changes active status only for unused locations. Used-location closeout is unavailable here; no stock, history or open work was changed.',
  storage_location_version_conflict: 'This location changed after your review. Refresh and review its current version before submitting again.',
  storage_location_request_conflict: 'This request identifier is bound to another reviewed change. Check the original result before continuing.',
  storage_location_code_conflict: 'This code already identifies a location, including inactive locations. Choose a different permanent code.',
  storage_location_busy: 'Another operation is using this location or request. Keep the original request and check its result before continuing.',
  storage_location_not_found: 'The exact location or original result is unavailable.',
  reauth_required: 'Current credentials must be confirmed before this protected action. No change was recorded. Refresh and review after confirmation.',
}[error?.data?.error?.code] || 'Current storage location evidence could not be confirmed. Refresh and review before continuing.');
