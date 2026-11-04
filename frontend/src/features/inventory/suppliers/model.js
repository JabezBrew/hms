import { canonical, exact, inputDigest, same, validId, validTimestamp } from '../catalog/model';
export { canonical, exact, inputDigest, same, validId, validTimestamp };

export const CONTACT_FIELDS = ['contact_name', 'phone', 'email', 'address'];
export const CONTACT_LABELS = { contact_name: 'Contact name', phone: 'Phone', email: 'Email', address: 'Address' };
const FIELDS = ['id', 'code', 'name', ...CONTACT_FIELDS, 'is_active', 'version', 'catalog_changed_at', 'created_at', 'updated_at', 'created_by_user_id', 'updated_by_user_id'];
const nullable = (value, check) => value === null || check(value);
const string = value => typeof value === 'string';
const version = value => Number.isSafeInteger(value) && value > 0;
const nonblank = value => string(value) && value.trim().length > 0;
export const invalidEvidence = () => new Error('Current supplier evidence could not be confirmed. Refresh and review before continuing.');
const requireEvidence = condition => { if (!condition) throw invalidEvidence(); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const clone = value => structuredClone(value);
function wellFormed(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
const noControls = (value, multiline = false) => ![...value].some(char => {
  const code = char.codePointAt(0);
  return (code < 32 && !(multiline && [9, 10, 13].includes(code))) || (code >= 127 && code <= 159);
});
const bytes = value => new TextEncoder().encode(value).length;
export const validNewText = (value, kind = 'name') => nonblank(value) && value.trim() === value && wellFormed(value) && noControls(value)
  && [...value].length <= ({ code: 120, name: 100, reason: 1000 })[kind] && bytes(value) <= ({ code: 480, name: 400, reason: 4000 })[kind];
// Email syntax belongs to the server: quoted ASCII local parts and IDN domains
// cannot be safely represented by HTML's email validity rules. No DNS claim.
export const validContactText = (value, field) => value === null || (string(value) && wellFormed(value) && noControls(value, field === 'address')
  && [...value].length <= ({ contact_name: 100, phone: 20, email: 254, address: 8000 })[field]
  && bytes(value) <= ({ contact_name: 400, phone: 80, email: 1016, address: 8000 })[field]);
function normalizeText(value, kind) {
  if (!string(value) || !validNewText(value.trim(), kind)) throw new Error(`Use a nonblank ${kind} of up to ${{ code: 120, name: 100, reason: 1000 }[kind]} characters without control characters.`);
  return value.trim();
}
export function supplierState(value, id = null) {
  requireEvidence(exact(value, FIELDS) && validId(value.id) && (id === null || value.id === id) && string(value.code) && string(value.name)
    && CONTACT_FIELDS.every(field => nullable(value[field], string)) && typeof value.is_active === 'boolean' && version(value.version)
    && validTimestamp(value.created_at) && validTimestamp(value.updated_at) && nullable(value.catalog_changed_at, validTimestamp)
    && nullable(value.created_by_user_id, validId) && nullable(value.updated_by_user_id, validId));
  return value;
}
export function supplierDetail(value, id = null) {
  requireEvidence(exact(value, ['supplier', 'eligibility']) && exact(value.eligibility, ['lifecycle_blocked_by'])
    && [null, 'item_reference'].includes(value.eligibility.lifecycle_blocked_by));
  supplierState(value.supplier, id); return value;
}
function cursorPage(value, validate) {
  const page = value?.page;
  requireEvidence(exact(value, ['data', 'page', 'meta']) && value.meta !== null && typeof value.meta === 'object' && !Array.isArray(value.meta)
    && exact(page, ['has_next', 'next_cursor', 'limit']) && Array.isArray(value.data) && typeof page.has_next === 'boolean'
    && version(page.limit) && page.limit <= 100 && value.data.length <= page.limit && (page.has_next ? nonblank(page.next_cursor) : page.next_cursor === null));
  value.data.forEach(validate); requireEvidence(new Set(value.data.map(row => row.id)).size === value.data.length);
  return value;
}
export function supplierListItem(value) {
  requireEvidence(exact(value, ['id', 'code', 'name', 'is_active', 'version', 'catalog_changed_at', 'created_at'])
    && validId(value.id) && string(value.code) && string(value.name) && typeof value.is_active === 'boolean' && version(value.version)
    && nullable(value.catalog_changed_at, validTimestamp) && validTimestamp(value.created_at));
  return value;
}
export const supplierPage = value => cursorPage(value, supplierListItem);
export function reviewedInput(value, previous = null) {
  const base = ['action', 'client_request_id'];
  requireEvidence(validId(value?.client_request_id));
  if (value.action === 'create') {
    requireEvidence(exact(value, [...base, 'code', 'name', ...CONTACT_FIELDS]) && validNewText(value.code, 'code') && validNewText(value.name)
      && CONTACT_FIELDS.every(field => validContactText(value[field], field)));
  } else if (['correct', 'retire', 'reactivate'].includes(value.action)) {
    requireEvidence(exact(value, [...base, 'supplier_id', 'expected_version', ...(value.action === 'correct' ? ['name', ...CONTACT_FIELDS, 'reason'] : [])])
      && validId(value.supplier_id) && version(value.expected_version));
    if (previous) { supplierState(previous, value.supplier_id); requireEvidence(previous.version === value.expected_version); }
    if (value.action === 'correct') requireEvidence(string(value.name) && (!previous || value.name === previous.name || validNewText(value.name))
      && CONTACT_FIELDS.every(field => nullable(value[field], string) && (!previous || value[field] === previous[field] || validContactText(value[field], field)))
      && validNewText(value.reason, 'reason'));
  } else throw invalidEvidence();
  return value;
}
export function normalizeInput(input, previous = null) {
  const value = clone(input);
  if (value?.action === 'create') {
    requireEvidence(exact(value, ['action', 'client_request_id', 'code', 'name', ...CONTACT_FIELDS]));
    value.code = normalizeText(value.code, 'code'); value.name = normalizeText(value.name, 'name');
  } else if (value?.action === 'correct') {
    requireEvidence(exact(value, ['action', 'client_request_id', 'supplier_id', 'expected_version', 'name', ...CONTACT_FIELDS, 'reason']));
    supplierState(previous, value.supplier_id);
    if (value.name !== previous.name) value.name = normalizeText(value.name, 'name');
    value.reason = normalizeText(value.reason, 'reason');
  }
  for (const field of CONTACT_FIELDS) if ((value.action === 'create' || (value.action === 'correct' && value[field] !== previous[field])) && !validContactText(value[field], field)) {
    throw new Error(`Review the supported ${CONTACT_LABELS[field].toLowerCase()} length and plain-text characters. Unchanged historical text can be retained exactly.`);
  }
  reviewedInput(value, previous); return value;
}
export async function prepareCommand(input, actorId, previous = null) {
  const snapshot = { input: clone(input), actorId, previous: previous === null ? null : clone(previous) };
  requireEvidence(validId(actorId)); snapshot.input = normalizeInput(snapshot.input, snapshot.previous);
  if (snapshot.input.action === 'create') requireEvidence(snapshot.previous === null);
  else requireEvidence(snapshot.previous && supplierState(snapshot.previous, snapshot.input.supplier_id).version === snapshot.input.expected_version);
  snapshot.digest = await inputDigest(snapshot.input); return freeze(snapshot);
}
export async function validateCommand(command) {
  const value = clone(command);
  requireEvidence(exact(value, ['input', 'actorId', 'previous', 'digest']) && validId(value.actorId)); reviewedInput(value.input, value.previous);
  if (value.input.action === 'create') requireEvidence(value.previous === null);
  else requireEvidence(value.previous && supplierState(value.previous, value.input.supplier_id).version === value.input.expected_version);
  requireEvidence(value.digest === await inputDigest(value.input)); return freeze(value);
}
const metadataFields = ['name', ...CONTACT_FIELDS];
export async function commandReceipt(value, { requestId, actorId, input = null, previous = null } = {}) {
  const receipt = clone(value ?? null), expected = input === null ? null : clone(input), prior = previous === null ? null : clone(previous);
  requireEvidence(exact(receipt, ['client_request_id', 'input_digest', 'reviewed_input', 'recorded_by_user_id', 'supplier', 'changed', 'recorded_at', 'before'])
    && validId(requestId) && validId(actorId) && receipt.client_request_id === requestId && receipt.recorded_by_user_id === actorId
    && /^[0-9a-f]{64}$/.test(receipt.input_digest) && typeof receipt.changed === 'boolean' && validTimestamp(receipt.recorded_at));
  const before = receipt.before === null ? null : supplierState(receipt.before), command = reviewedInput(receipt.reviewed_input, before), supplier = supplierState(receipt.supplier);
  requireEvidence(command.client_request_id === requestId && (!expected || same(command, reviewedInput(expected, prior))));
  if (command.action === 'create') requireEvidence(before === null && prior === null && receipt.changed && supplier.version === 1 && supplier.is_active && supplier.code === command.code
    && metadataFields.every(field => supplier[field] === command[field]) && supplier.created_by_user_id === actorId && supplier.updated_by_user_id === actorId);
  else {
    requireEvidence(before !== null && before.id === command.supplier_id && before.version === command.expected_version && supplier.id === command.supplier_id
      && supplier.version === command.expected_version + Number(receipt.changed) && ['code', 'created_at', 'created_by_user_id'].every(field => supplier[field] === before[field])
      && (!prior || same(before, prior)));
    if (command.action === 'correct') requireEvidence(metadataFields.every(field => supplier[field] === command[field]) && supplier.is_active === before.is_active
      && receipt.changed === metadataFields.some(field => before[field] !== supplier[field]));
    else requireEvidence(supplier.is_active === (command.action === 'reactivate') && receipt.changed === (supplier.is_active !== before.is_active)
      && metadataFields.every(field => supplier[field] === before[field]));
    requireEvidence(receipt.changed ? supplier.updated_by_user_id === actorId && supplier.catalog_changed_at === receipt.recorded_at
      : ['updated_by_user_id', 'catalog_changed_at', 'updated_at'].every(field => supplier[field] === before[field]));
  }
  requireEvidence(await inputDigest(command) === receipt.input_digest); return freeze(receipt);
}
export function historyRecord(value) {
  const flags = ['name_changed', ...CONTACT_FIELDS.map(field => `${field}_changed`), 'active_changed'];
  requireEvidence(exact(value, ['id', 'action', 'recorded_at', 'before_version', 'after_version', ...flags]) && validId(value.id)
    && ['create', 'correct', 'retire', 'reactivate'].includes(value.action) && validTimestamp(value.recorded_at) && flags.every(field => typeof value[field] === 'boolean') && version(value.after_version));
  if (value.action === 'create') requireEvidence(value.before_version === null && value.after_version === 1);
  else requireEvidence(version(value.before_version) && value.after_version === value.before_version + Number(flags.some(field => value[field])));
  return value;
}
export const historyPage = value => cursorPage(value, historyRecord);
export const displayText = value => nonblank(value) ? value : 'Not recorded';
export const errorCopy = error => ({
  inventory_supplier_referenced: 'A retained item still references this supplier, including inactive or malformed references. Active state can change only for unused suppliers.',
  inventory_supplier_version_conflict: 'This supplier changed after review. Refresh and review its current revision.',
  inventory_supplier_request_conflict: 'This request identifier belongs to another reviewed change. Check the original result.',
  inventory_supplier_code_conflict: 'This permanent code already identifies a supplier, including retired suppliers. Choose another code.',
  inventory_supplier_not_found: 'The exact supplier or original result is unavailable.',
  inventory_supplier_busy: 'Another operation is using this supplier or request. Keep the original request and check its result.',
  inventory_supplier_projection_conflict: 'The supplier search projection needs operator review before this change can be published.',
  invalid_inventory_supplier_command: 'The server could not admit the reviewed supplier text. Review supported lengths and email syntax before preparing another request.',
  reauth_required: 'Confirm current credentials before this protected action, then refresh and review.',
}[error?.data?.error?.code] || 'Current supplier evidence could not be confirmed. Refresh and review before continuing.');
