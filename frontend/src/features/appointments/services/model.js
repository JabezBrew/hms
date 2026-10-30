const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = value => typeof value === 'string' && UUID.test(value) && value !== '00000000-0000-0000-0000-000000000000';
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const invalid = () => new Error('Current service evidence could not be confirmed. Refresh before continuing.');
const bytes = value => new TextEncoder().encode(value).length;
export const validName = value => text(value) && value.trim() === value && bytes(value) <= 160 && ![...value].some(char => { const code = char.codePointAt(0); return code < 32 || (code >= 127 && code <= 159); });
export const validDuration = value => Number.isSafeInteger(value) && value >= 1 && value <= 1440;
export function serviceState(value, id = null) {
  if (!exact(value, ['id', 'code', 'name', 'default_duration_minutes', 'is_active', 'version', 'created_at', 'updated_at']) || !validId(value.id) || (id !== null && value.id !== id) || typeof value.code !== 'string' || typeof value.name !== 'string' || !Number.isInteger(value.default_duration_minutes) || value.default_duration_minutes < 1 || value.default_duration_minutes > 2147483647 || typeof value.is_active !== 'boolean' || !Number.isSafeInteger(value.version) || value.version < 1 || !date(value.created_at) || !date(value.updated_at)) throw invalid();
  return value;
}
export function servicePage(value) {
  const page = value?.page;
  if (!Array.isArray(value?.data) || !page || typeof page.has_next !== 'boolean' || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.limit > 100 || value.data.length > page.limit || (page.has_next ? !text(page.next_cursor) : page.next_cursor !== null)) throw invalid();
  value.data.forEach(row => serviceState(row));
  if (new Set(value.data.map(row => row.id)).size !== value.data.length) throw invalid();
  return value;
}
export function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
export const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export async function inputDigest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export function reviewedInput(value) {
  const base = ['action', 'client_request_id'];
  if (!validId(value?.client_request_id)) throw invalid();
  if (value.action === 'create') {
    if (!exact(value, [...base, 'code', 'name', 'default_duration_minutes']) || typeof value.code !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(value.code) || !validName(value.name) || !validDuration(value.default_duration_minutes)) throw invalid();
  } else if (['metadata', 'retire', 'reactivate'].includes(value.action)) {
    const metadata = value.action === 'metadata';
    if (!exact(value, [...base, 'service_id', 'expected_version', ...(metadata ? ['name', 'default_duration_minutes'] : [])]) || !validId(value.service_id) || !Number.isSafeInteger(value.expected_version) || value.expected_version < 1 || (metadata && (!validName(value.name) || !validDuration(value.default_duration_minutes)))) throw invalid();
  } else throw invalid();
  return value;
}
export async function commandReceipt(value, { requestId, actorId, input = null, previous = null } = {}) {
  // Copy before asynchronous hashing so a later consumer cannot change evidence.
  const receipt = structuredClone(value ?? null);
  if (!exact(receipt, ['client_request_id', 'input_digest', 'reviewed_input', 'recorded_by_user_id', 'service', 'changed', 'recorded_at']) || !validId(requestId) || !validId(actorId) || receipt.client_request_id !== requestId || receipt.recorded_by_user_id !== actorId || !/^[0-9a-f]{64}$/.test(receipt.input_digest) || typeof receipt.changed !== 'boolean' || !date(receipt.recorded_at)) throw invalid();
  const command = reviewedInput(receipt.reviewed_input), service = serviceState(receipt.service);
  if (command.client_request_id !== requestId || (input && !same(command, reviewedInput(input)))) throw invalid();
  if (command.action === 'create') {
    if (!receipt.changed || service.version !== 1 || service.code !== command.code || service.name !== command.name || service.default_duration_minutes !== command.default_duration_minutes || !service.is_active || service.created_at !== service.updated_at) throw invalid();
  } else {
    if (service.id !== command.service_id || service.version !== command.expected_version + (receipt.changed ? 1 : 0) || (command.action === 'metadata' && (service.name !== command.name || service.default_duration_minutes !== command.default_duration_minutes)) || (command.action === 'retire' && service.is_active) || (command.action === 'reactivate' && !service.is_active)) throw invalid();
    if (previous) {
      serviceState(previous, command.service_id);
      const changed = service.name !== previous.name || service.default_duration_minutes !== previous.default_duration_minutes || service.is_active !== previous.is_active;
      if (previous.version !== command.expected_version || service.code !== previous.code || service.created_at !== previous.created_at || (!receipt.changed && service.updated_at !== previous.updated_at) || (command.action === 'metadata' ? service.is_active !== previous.is_active : service.name !== previous.name || service.default_duration_minutes !== previous.default_duration_minutes) || receipt.changed !== changed) throw invalid();
    }
  }
  if (await inputDigest(command) !== receipt.input_digest) throw invalid();
  return receipt;
}
export async function prepareCommand(input, actorId, previous = null) {
  reviewedInput(input); if (!validId(actorId)) throw invalid();
  if (input.action !== 'create' && (!previous || serviceState(previous, input.service_id).version !== input.expected_version)) throw invalid();
  return { input: structuredClone(input), actorId, previous: previous ? structuredClone(previous) : null, digest: await inputDigest(input) };
}
export async function validateCommand(command) {
  reviewedInput(command?.input); if (!validId(command.actorId) || command.digest !== await inputDigest(command.input)) throw invalid();
  if (command.input.action !== 'create' && (!command.previous || serviceState(command.previous, command.input.service_id).version !== command.input.expected_version)) throw invalid();
  return command;
}
export const errorCopy = error => ({
  appointment_type_future_generator: 'An active template can still generate future sessions using this service. Review that scheduling setup through its supported workflow before retiring this service. Existing bookings were not cancelled.',
  appointment_type_version_conflict: 'This service changed after your review. Refresh and review its current version before submitting again.',
  appointment_type_request_conflict: 'This request identifier is bound to another reviewed change. Check the original result before continuing.',
  appointment_type_code_conflict: 'This code already identifies a service, including retired services. Choose a different permanent code.',
  appointment_type_busy: 'Another operation is using this service or request. No change was recorded. Refresh and review before continuing.',
  appointment_type_not_found: 'The exact service or original result is unavailable.',
  reauth_required: 'Current credentials must be confirmed before this protected action. No change was recorded. Refresh and review after confirmation.',
}[error?.data?.error?.code] || 'Current service evidence could not be confirmed. Refresh and review before continuing.');
