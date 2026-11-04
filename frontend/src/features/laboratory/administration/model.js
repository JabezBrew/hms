// Closed runtime observations for the proposed compiled laboratory contract.
// These checks do not grant authority: publication also needs the real read lease.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = value => typeof value === 'string' && UUID.test(value) && value !== '00000000-0000-0000-0000-000000000000';
export const exact = (value, fields) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)));
export const version = value => Number.isSafeInteger(value) && value > 0;
const text = value => typeof value === 'string';
const nullable = (value, check) => value === null || check(value);
function instant(value) {
  if (!text(value)) return false;
  const match = /^([+-]?\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return Number.isSafeInteger(year) && month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    && Number(match[4]) < 24 && Number(match[5]) < 60 && Number(match[6]) <= 60 && (match[7] === 'Z' || (Number(match[7].slice(1, 3)) < 24 && Number(match[7].slice(4)) < 60));
}
export const invalidEvidence = () => new Error('Current laboratory catalog evidence could not be confirmed. Refresh and review before continuing.');
const requireEvidence = condition => { if (!condition) throw invalidEvidence(); };
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
export async function inputDigest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const commonDefinition = ['id', 'code', 'name', 'is_active', 'is_system_default', 'is_facility_modified', 'created_at', 'updated_at', 'version', 'catalog_changed_at', 'catalog_changed_by_user_id'];
export const validKind = kind => ['test', 'panel'].includes(kind);
export function catalogDetail(value, kind = value?.kind, id = null) {
  requireEvidence(validKind(kind) && exact(value, ['kind', 'definition', 'ordering']) && value.kind === kind);
  const row = value.definition, ordering = value.ordering;
  requireEvidence(exact(row, [...commonDefinition, ...(kind === 'test' ? ['category', 'specimen_type', 'result_unit'] : ['test_count'])])
    && validId(row.id) && (id === null || row.id === id) && text(row.code) && text(row.name) && version(row.version)
    && ['is_active', 'is_system_default', 'is_facility_modified'].every(key => typeof row[key] === 'boolean')
    && instant(row.created_at) && instant(row.updated_at) && nullable(row.catalog_changed_at, instant) && nullable(row.catalog_changed_by_user_id, validId));
  if (kind === 'test') requireEvidence(nullable(row.category, text) && text(row.specimen_type) && nullable(row.result_unit, text));
  else requireEvidence(Number.isSafeInteger(row.test_count) && row.test_count >= 0);
  requireEvidence(exact(ordering, ['is_orderable', 'blocked_by']) && typeof ordering.is_orderable === 'boolean'
    && [null, 'inactive', 'empty_panel', 'unavailable_members'].includes(ordering.blocked_by)
    && ordering.is_orderable === (ordering.blocked_by === null)
    && (row.is_active ? ordering.blocked_by !== 'inactive' : ordering.blocked_by === 'inactive')
    && (kind === 'panel' || !['empty_panel', 'unavailable_members'].includes(ordering.blocked_by)));
  if (row.is_active) requireEvidence(kind === 'test' ? ordering.blocked_by === null : row.test_count === 0 ? ordering.blocked_by === 'empty_panel' : [null, 'unavailable_members'].includes(ordering.blocked_by));
  return value;
}
export function catalogListItem(row) {
  requireEvidence(exact(row, ['id', 'code', 'name', 'is_active', 'version', 'catalog_changed_at', 'created_at'])
    && validId(row.id) && text(row.code) && text(row.name) && typeof row.is_active === 'boolean' && version(row.version)
    && nullable(row.catalog_changed_at, instant) && instant(row.created_at));
  return row;
}
function cursorPage(value, validate) {
  requireEvidence(exact(value, ['data', 'page', 'meta']) && value.meta !== null && typeof value.meta === 'object' && !Array.isArray(value.meta)
    && exact(value.page, ['has_next', 'next_cursor', 'limit']) && version(value.page.limit) && value.page.limit <= 100
    && typeof value.page.has_next === 'boolean' && (value.page.has_next ? text(value.page.next_cursor) && value.page.next_cursor.length > 0 : value.page.next_cursor === null)
    && Array.isArray(value.data) && value.data.length <= value.page.limit);
  value.data.forEach(validate); requireEvidence(new Set(value.data.map(row => row.id)).size === value.data.length); return value;
}
export const catalogPage = value => cursorPage(value, catalogListItem);
export function historyRow(row) {
  requireEvidence(exact(row, ['id', 'action', 'recorded_at', 'before_version', 'after_version', 'before_is_active', 'after_is_active', 'changed'])
    && validId(row.id) && row.action === 'set_availability' && instant(row.recorded_at) && version(row.before_version) && version(row.after_version)
    && typeof row.before_is_active === 'boolean' && typeof row.after_is_active === 'boolean' && typeof row.changed === 'boolean'
    && row.changed === (row.before_is_active !== row.after_is_active) && row.after_version === row.before_version + Number(row.changed));
  return row;
}
export const historyPage = value => cursorPage(value, historyRow);
function wellFormed(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
const noControls = value => ![...value].some(char => { const code = char.codePointAt(0); return code < 32 || (code >= 127 && code <= 159); });
// Unicode White_Space matches the backend's scalar whitespace normalization;
// ECMAScript String.trim additionally removes FEFF, which is not that property.
const trimWhitespace = value => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '');
export function normalizeReason(value) {
  if (!text(value)) throw invalidEvidence();
  const normalized = trimWhitespace(value);
  if (!normalized || !wellFormed(normalized) || !noControls(normalized) || [...normalized].length > 1000 || new TextEncoder().encode(normalized).length > 4000) throw new Error('Enter a reason of up to 1,000 characters without control characters.');
  return normalized;
}
export function normalizeSearch(value) {
  const normalized = trimWhitespace(String(value ?? ''));
  if (!wellFormed(normalized) || !noControls(normalized) || new TextEncoder().encode(normalized).length > 160) throw new Error('Search code or name using up to 160 UTF-8 bytes without control characters.');
  return normalized;
}
export function reviewedInput(value) {
  requireEvidence(exact(value, ['action', 'subject_kind', 'subject_id', 'client_request_id', 'expected_version', 'is_active', 'reason'])
    && value.action === 'set_availability' && validKind(value.subject_kind) && validId(value.subject_id) && validId(value.client_request_id)
    && version(value.expected_version) && typeof value.is_active === 'boolean' && value.reason === normalizeReason(value.reason));
  return value;
}
export async function prepareCommand(input, actorId, previous) {
  const fixed = { input: structuredClone(input), actorId, previous: structuredClone(previous) };
  fixed.input.reason = normalizeReason(fixed.input.reason);
  reviewedInput(fixed.input); catalogDetail(fixed.previous, input.subject_kind, input.subject_id);
  requireEvidence(validId(actorId) && fixed.previous.definition.version === input.expected_version);
  return freeze({ ...fixed, digest: await inputDigest(fixed.input) });
}
export async function validateCommand(command) {
  const fixed = structuredClone(command);
  requireEvidence(exact(fixed, ['input', 'actorId', 'previous', 'digest']) && validId(fixed.actorId));
  reviewedInput(fixed.input); catalogDetail(fixed.previous, fixed.input.subject_kind, fixed.input.subject_id);
  requireEvidence(fixed.previous.definition.version === fixed.input.expected_version && fixed.digest === await inputDigest(fixed.input)); return freeze(fixed);
}
export async function commandReceipt(value, { requestId, actorId, input = null, previous = null } = {}) {
  const receipt = structuredClone(value ?? null);
  requireEvidence(exact(receipt, ['command_id', 'client_request_id', 'input_digest', 'reviewed_input', 'subject', 'recorded_at', 'recorded_by_user_id', 'changed'])
    && validId(receipt.command_id) && validId(requestId) && receipt.client_request_id === requestId && validId(actorId) && receipt.recorded_by_user_id === actorId
    && /^[0-9a-f]{64}$/.test(receipt.input_digest) && instant(receipt.recorded_at) && typeof receipt.changed === 'boolean');
  const intent = reviewedInput(receipt.reviewed_input), subject = catalogDetail(receipt.subject, intent.subject_kind, intent.subject_id), row = subject.definition;
  requireEvidence(intent.client_request_id === requestId && (!input || same(intent, reviewedInput(input))) && row.is_active === intent.is_active
    && row.version === intent.expected_version + Number(receipt.changed) && receipt.input_digest === await inputDigest(intent));
  if (previous) {
    catalogDetail(previous, intent.subject_kind, intent.subject_id);
    requireEvidence(previous.definition.version === intent.expected_version && receipt.changed === (previous.definition.is_active !== intent.is_active));
    const immutable = Object.keys(row).filter(key => !['is_active', 'version', 'updated_at', 'catalog_changed_at', 'catalog_changed_by_user_id'].includes(key));
    requireEvidence(immutable.every(key => same(row[key], previous.definition[key])));
    // A member test can change a panel's ordering observation without changing
    // this definition's revision. The original owns its command-time ordering;
    // a no-op must preserve the exact definition, not an earlier joined read.
    if (!receipt.changed) requireEvidence(same(row, previous.definition));
  }
  if (receipt.changed) requireEvidence(row.catalog_changed_at === receipt.recorded_at && row.catalog_changed_by_user_id === actorId && row.updated_at === receipt.recorded_at);
  return freeze(receipt);
}
export const orderingCopy = observation => ({ inactive: 'Inactive · unavailable for new orders', empty_panel: 'No configured tests · unavailable for new orders', unavailable_members: 'A configured test is unavailable · new orders are blocked' }[observation?.blocked_by] || 'Available for new orders');
export const errorCopy = error => ({ reauth_required: 'Confirm current credentials, then refresh and review. Confirmation does not grant permissions.', laboratory_catalog_version_conflict: 'This definition changed after review. Refresh and review its current revision.', laboratory_catalog_request_conflict: 'This request reference belongs to a different reviewed change. Check its original result.', laboratory_catalog_busy: 'Another operation is using this definition or request. Check the original result before another change.' }[error?.data?.error?.code] || 'Current laboratory catalog evidence could not be confirmed. Refresh and review before continuing.');
