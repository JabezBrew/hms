const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = value => typeof value === 'string' && UUID.test(value) && value !== '00000000-0000-0000-0000-000000000000';
export const UNIT_TYPES = { facility: 'Facility', department: 'Department', clinic: 'Clinic', ward: 'Ward', service: 'Service', administrative: 'Administrative' };
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const invalid = () => new Error('Current organization unit evidence could not be confirmed. Refresh before continuing.');
export function unitState(value, id = null) {
  if (!validId(value?.id) || (id !== null && value.id !== id) || !text(value.code) || !text(value.name) || !Object.hasOwn(UNIT_TYPES, value.unit_type) || !(value.parent_unit_id === null || validId(value.parent_unit_id)) || !(value.parent_unit_name === null || text(value.parent_unit_name)) || typeof value.is_active !== 'boolean' || !Number.isSafeInteger(value.version) || value.version < 1 || !date(value.created_at) || !date(value.updated_at)) throw invalid();
  return value;
}
export function unitPage(value) {
  const page = value?.page;
  if (!Array.isArray(value?.data) || !page || typeof page.has_next !== 'boolean' || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100 || value.data.length > page.limit || (page.has_next ? !text(page.next_cursor) : page.next_cursor !== null)) throw invalid();
  value.data.forEach(row => unitState(row));
  if (new Set(value.data.map(row => row.id)).size !== value.data.length) throw invalid();
  return value;
}

export const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
export async function inputDigest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const bytes = value => new TextEncoder().encode(value).length;
export const validName = value => text(value) && bytes(value) <= 160 && ![...value].some(char => { const code = char.codePointAt(0); return code < 32 || (code >= 127 && code <= 159); });
export function reviewedInput(value) {
  const base = ['action', 'client_request_id'];
  if (!validId(value?.client_request_id)) throw invalid();
  if (value.action === 'create') {
    if (!exact(value, [...base, 'code', 'name', 'unit_type', 'parent_unit_id']) || !/^[A-Za-z0-9_-]{1,48}$/.test(value.code) || !validName(value.name) || !Object.hasOwn(UNIT_TYPES, value.unit_type) || !(value.parent_unit_id === null || validId(value.parent_unit_id))) throw invalid();
  } else if (['rename', 'retire', 'reactivate'].includes(value.action)) {
    if (!exact(value, [...base, 'unit_id', 'expected_version', ...(value.action === 'rename' ? ['name'] : [])]) || !validId(value.unit_id) || !Number.isSafeInteger(value.expected_version) || value.expected_version < 1 || (value.action === 'rename' && !validName(value.name))) throw invalid();
  } else throw invalid();
  return value;
}
export async function commandReceipt(value, { requestId, actorId, input = null, previous = null } = {}) {
  // A private value copy prevents asynchronous hashing from certifying an object
  // changed by another consumer while its digest was pending.
  const receipt = JSON.parse(JSON.stringify(value ?? null));
  if (!exact(receipt, ['client_request_id', 'input_digest', 'reviewed_input', 'recorded_by_user_id', 'unit', 'changed', 'recorded_at']) || !validId(requestId) || !validId(actorId) || receipt.client_request_id !== requestId || receipt.recorded_by_user_id !== actorId || !/^[0-9a-f]{64}$/.test(receipt.input_digest) || typeof receipt.changed !== 'boolean' || !date(receipt.recorded_at)) throw invalid();
  const command = reviewedInput(receipt.reviewed_input), unit = unitState(receipt.unit);
  if (command.client_request_id !== requestId || (input && !same(command, reviewedInput(input)))) throw invalid();
  if (command.action === 'create') {
    if (!receipt.changed || unit.version !== 1 || unit.code !== command.code || unit.name !== command.name || unit.unit_type !== command.unit_type || unit.parent_unit_id !== command.parent_unit_id || !unit.is_active || unit.created_at !== unit.updated_at) throw invalid();
  } else {
    if (unit.id !== command.unit_id || unit.version !== command.expected_version + (receipt.changed ? 1 : 0) || (command.action === 'rename' && unit.name !== command.name) || (command.action === 'retire' && unit.is_active) || (command.action === 'reactivate' && !unit.is_active)) throw invalid();
    if (previous) {
      unitState(previous, command.unit_id);
      if (previous.version !== command.expected_version || unit.code !== previous.code || unit.unit_type !== previous.unit_type || unit.parent_unit_id !== previous.parent_unit_id || unit.created_at !== previous.created_at || (command.action === 'rename' ? unit.is_active !== previous.is_active : unit.name !== previous.name) || receipt.changed !== (unit.name !== previous.name || unit.is_active !== previous.is_active)) throw invalid();
    }
  }
  if (await inputDigest(command) !== receipt.input_digest) throw invalid();
  return receipt;
}
export async function prepareCommand(input, actorId, previous = null) {
  reviewedInput(input); if (!validId(actorId)) throw invalid();
  if (input.action !== 'create' && (!previous || unitState(previous, input.unit_id).version !== input.expected_version)) throw invalid();
  return { input: structuredClone(input), actorId, previous: previous ? structuredClone(previous) : null, digest: await inputDigest(input) };
}
export async function validateCommand(command) {
  reviewedInput(command?.input); if (!validId(command.actorId) || command.digest !== await inputDigest(command.input)) throw invalid();
  if (command.input.action !== 'create' && (!command.previous || unitState(command.previous, command.input.unit_id).version !== command.input.expected_version)) throw invalid();
  return command;
}
export const errorCopy = error => ({
  organization_unit_has_children: 'This unit has child units, including possible inactive or historical units. These recorded links prevent changing active status in this workflow; closing or revoking them does not remove their history.',
  organization_unit_has_positions: 'This unit has position references, including possible inactive or historical positions. These recorded links prevent changing active status in this workflow; closing or revoking them does not remove their history.',
  organization_unit_has_scope_grants: 'This unit has scoped permission references, including possible inactive or historical grants. These recorded links prevent changing active status in this workflow; closing or revoking them does not remove their history.',
  organization_unit_parent_unavailable: 'The retained parent must be active and available. Refresh the parent before reviewing this change again.',
  organization_unit_version_conflict: 'This unit changed after your review. Refresh and review its current version before submitting again.',
  organization_unit_request_conflict: 'This request identifier is already bound to a different change. Check the original result before continuing.',
  organization_unit_busy: 'Another change is currently being reviewed. Refresh and try again once it finishes.',
  organization_unit_not_found: 'The exact organization unit is unavailable.',
  fresh_identity_proof_required: 'Verify your identity using the notice above, then refresh and review this change again.',
}[error?.data?.error?.code] || 'The organization change could not be confirmed. Refresh and review before continuing.');

export const parentLabel = unit => unit.parent_unit_id === null ? 'No visible parent unit' : unit.parent_unit_name || 'Parent details unavailable';
