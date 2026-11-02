import { canonical, exact, inputDigest, same, validId, validTimestamp } from '../catalog/model';
export { canonical, exact, inputDigest, same, validId, validTimestamp };

const FIELDS = ['id', 'code', 'name', 'description', 'parent_id', 'parent', 'is_active', 'version', 'catalog_changed_at', 'created_at', 'created_by_user_id', 'updated_by_user_id'];
const nullable = (value, check) => value === null || check(value);
const string = value => typeof value === 'string';
const version = value => Number.isSafeInteger(value) && value > 0;
const nonblank = value => string(value) && value.trim().length > 0;
export const invalidEvidence = () => new Error('Current category evidence could not be confirmed. Refresh and review before continuing.');
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
const noControls = (value, description = false) => ![...value].some(char => {
  const code = char.codePointAt(0);
  return (code < 32 && !(description && [9, 10, 13].includes(code))) || (code >= 127 && code <= 159);
});
const bytes = value => new TextEncoder().encode(value).length;
export const validNewText = (value, kind = 'name') => nonblank(value) && value.trim() === value && wellFormed(value) && noControls(value)
  && [...value].length <= ({ code: 120, name: 100, reason: 1000 })[kind] && bytes(value) <= ({ code: 480, name: 400, reason: 4000 })[kind];
export const validDescription = value => value === null || (string(value) && wellFormed(value) && noControls(value, true) && bytes(value) <= 8000);
function normalizeText(value, kind) {
  if (!string(value) || !validNewText(value.trim(), kind)) throw new Error(`Use a nonblank ${kind} of up to ${{ code: 120, name: 100, reason: 1000 }[kind]} characters without control characters.`);
  return value.trim();
}
export function categoryState(value, id = null) {
  requireEvidence(exact(value, FIELDS) && validId(value.id) && (id === null || value.id === id) && string(value.code) && string(value.name)
    && nullable(value.description, string) && nullable(value.parent_id, validId) && typeof value.is_active === 'boolean' && version(value.version)
    && validTimestamp(value.created_at) && nullable(value.catalog_changed_at, validTimestamp)
    && nullable(value.created_by_user_id, validId) && nullable(value.updated_by_user_id, validId));
  if (value.parent !== null) requireEvidence(exact(value.parent, ['id', 'code', 'name', 'version', 'is_active']) && value.parent.id === value.parent_id
    && validId(value.parent.id) && string(value.parent.code) && string(value.parent.name) && version(value.parent.version) && typeof value.parent.is_active === 'boolean');
  if (value.parent_id === null) requireEvidence(value.parent === null);
  return value;
}
export function categoryDetail(value, id = null) {
  requireEvidence(exact(value, ['category', 'eligibility']) && exact(value.eligibility, ['lifecycle_blocked_by', 'parent_unavailable'])
    && [null, 'item_reference', 'child_reference'].includes(value.eligibility.lifecycle_blocked_by) && typeof value.eligibility.parent_unavailable === 'boolean');
  categoryState(value.category, id);
  requireEvidence(value.eligibility.parent_unavailable === (value.category.parent_id !== null && value.category.parent === null));
  return value;
}
function cursorPage(value, validate) {
  const page = value?.page;
  requireEvidence(exact(value, ['data', 'page', 'meta']) && value.meta !== null && typeof value.meta === 'object' && !Array.isArray(value.meta)
    && exact(page, ['has_next', 'next_cursor', 'limit']) && Array.isArray(value.data) && typeof page.has_next === 'boolean'
    && version(page.limit) && page.limit <= 100 && value.data.length <= page.limit && (page.has_next ? nonblank(page.next_cursor) : page.next_cursor === null));
  value.data.forEach(validate); requireEvidence(new Set(value.data.map(row => row.id)).size === value.data.length);
  // Preserve the protected original envelope, never a stripped/reconstructed copy.
  return value;
}
export function categoryListItem(value) {
  requireEvidence(exact(value, ['id', 'code', 'name', 'is_active', 'version', 'parent_id', 'catalog_changed_at', 'created_at'])
    && validId(value.id) && string(value.code) && string(value.name) && typeof value.is_active === 'boolean' && version(value.version)
    && nullable(value.parent_id, validId) && nullable(value.catalog_changed_at, validTimestamp) && validTimestamp(value.created_at));
  return value;
}
export const categoryPage = value => cursorPage(value, categoryListItem);
function parentSelection(value) {
  requireEvidence(exact(value, ['parent_id', 'expected_parent_version']) && validId(value.parent_id) && version(value.expected_parent_version));
  return value;
}
function parentChange(value) {
  if (value?.action === 'set') { requireEvidence(exact(value, ['action', 'parent_id', 'expected_parent_version'])); parentSelection({ parent_id: value.parent_id, expected_parent_version: value.expected_parent_version }); }
  else requireEvidence(exact(value, ['action']) && ['retain', 'clear'].includes(value.action));
  return value;
}
export function reviewedInput(value, previous = null) {
  const base = ['action', 'client_request_id'];
  requireEvidence(validId(value?.client_request_id));
  if (value.action === 'create') {
    requireEvidence(exact(value, [...base, 'code', 'name', 'description', 'parent']) && validNewText(value.code, 'code') && validNewText(value.name) && validDescription(value.description));
    if (value.parent !== null) parentSelection(value.parent);
  } else if (['correct', 'retire', 'reactivate'].includes(value.action)) {
    requireEvidence(exact(value, [...base, 'category_id', 'expected_version', ...(value.action === 'correct' ? ['name', 'description', 'parent_change', 'reason'] : [])])
      && validId(value.category_id) && version(value.expected_version));
    if (previous) { categoryState(previous, value.category_id); requireEvidence(previous.version === value.expected_version); }
    if (value.action === 'correct') {
      requireEvidence(string(value.name) && (!previous || value.name === previous.name || validNewText(value.name))
        && nullable(value.description, string) && (!previous || value.description === previous.description || validDescription(value.description)) && validNewText(value.reason, 'reason'));
      parentChange(value.parent_change);
    }
  } else throw invalidEvidence();
  return value;
}
export function normalizeInput(input, previous = null) {
  const value = clone(input);
  if (value?.action === 'create') {
    requireEvidence(exact(value, ['action', 'client_request_id', 'code', 'name', 'description', 'parent']));
    value.code = normalizeText(value.code, 'code'); value.name = normalizeText(value.name, 'name');
  } else if (value?.action === 'correct') {
    requireEvidence(exact(value, ['action', 'client_request_id', 'category_id', 'expected_version', 'name', 'description', 'parent_change', 'reason']));
    categoryState(previous, value.category_id);
    if (value.name !== previous.name) value.name = normalizeText(value.name, 'name');
    value.reason = normalizeText(value.reason, 'reason');
  }
  if ((value.action === 'create' || (value.action === 'correct' && value.description !== previous.description)) && !validDescription(value.description)) throw new Error('Use a plain-text description of up to 8,000 UTF-8 bytes. Only tabs and newlines are allowed among control characters.');
  reviewedInput(value, previous);
  return value;
}
export async function prepareCommand(input, actorId, previous = null) {
  const snapshot = { input: clone(input), actorId, previous: previous === null ? null : clone(previous) };
  requireEvidence(validId(actorId)); snapshot.input = normalizeInput(snapshot.input, snapshot.previous);
  if (snapshot.input.action === 'create') requireEvidence(snapshot.previous === null);
  else requireEvidence(snapshot.previous && categoryState(snapshot.previous, snapshot.input.category_id).version === snapshot.input.expected_version);
  snapshot.digest = await inputDigest(snapshot.input); return freeze(snapshot);
}
export async function validateCommand(command) {
  const value = clone(command);
  requireEvidence(exact(value, ['input', 'actorId', 'previous', 'digest']) && validId(value.actorId)); reviewedInput(value.input, value.previous);
  if (value.input.action === 'create') requireEvidence(value.previous === null);
  else requireEvidence(value.previous && categoryState(value.previous, value.input.category_id).version === value.input.expected_version);
  requireEvidence(value.digest === await inputDigest(value.input)); return freeze(value);
}
const projectionChanged = (before, next) => ['name', 'description', 'parent_id'].some(key => before[key] !== next[key]);
function selectedParentMatches(category, selection) {
  requireEvidence(category.parent_id === selection.parent_id && category.parent !== null && category.parent.version === selection.expected_parent_version && category.parent.is_active);
}
export async function commandReceipt(value, { requestId, actorId, input = null, previous = null } = {}) {
  const receipt = clone(value ?? null), expected = input === null ? null : clone(input), prior = previous === null ? null : clone(previous);
  requireEvidence(exact(receipt, ['client_request_id', 'input_digest', 'reviewed_input', 'recorded_by_user_id', 'category', 'changed', 'recorded_at', 'before'])
    && validId(requestId) && validId(actorId) && receipt.client_request_id === requestId && receipt.recorded_by_user_id === actorId
    && /^[0-9a-f]{64}$/.test(receipt.input_digest) && typeof receipt.changed === 'boolean' && validTimestamp(receipt.recorded_at));
  const before = receipt.before === null ? null : categoryState(receipt.before), command = reviewedInput(receipt.reviewed_input, before), category = categoryState(receipt.category);
  requireEvidence(command.client_request_id === requestId && (!expected || same(command, reviewedInput(expected, prior))));
  if (command.action === 'create') {
    requireEvidence(before === null && prior === null && receipt.changed && category.version === 1 && category.is_active && category.code === command.code && category.name === command.name
      && category.description === command.description && category.created_by_user_id === actorId && category.updated_by_user_id === actorId);
    if (command.parent === null) requireEvidence(category.parent_id === null && category.parent === null); else selectedParentMatches(category, command.parent);
  } else {
    requireEvidence(before !== null && before.id === command.category_id && before.version === command.expected_version && category.id === command.category_id
      && category.version === command.expected_version + Number(receipt.changed) && ['code', 'created_at', 'created_by_user_id'].every(key => category[key] === before[key])
      // The direct parent's display observation can change independently of
      // the subject revision. Retain binds the pointer, never an inherited name.
      && (!prior || FIELDS.filter(key => key !== 'parent').every(key => same(before[key], prior[key]))));
    if (command.action === 'correct') {
      requireEvidence(category.name === command.name && category.description === command.description && category.is_active === before.is_active && receipt.changed === projectionChanged(before, category));
      if (command.parent_change.action === 'retain') requireEvidence(category.parent_id === before.parent_id);
      else if (command.parent_change.action === 'clear') requireEvidence(category.parent_id === null && category.parent === null);
      else selectedParentMatches(category, command.parent_change);
    } else requireEvidence(category.is_active === (command.action === 'reactivate') && receipt.changed === (category.is_active !== before.is_active)
      && ['name', 'description', 'parent_id'].every(key => category[key] === before[key]));
    requireEvidence(receipt.changed ? category.updated_by_user_id === actorId && category.catalog_changed_at === receipt.recorded_at
      : category.updated_by_user_id === before.updated_by_user_id && category.catalog_changed_at === before.catalog_changed_at);
  }
  requireEvidence(await inputDigest(command) === receipt.input_digest); return freeze(receipt);
}
export function historyRecord(value) {
  const flags = ['name_changed', 'description_changed', 'parent_changed', 'active_changed'];
  requireEvidence(exact(value, ['id', 'action', 'recorded_at', 'before_version', 'after_version', ...flags]) && validId(value.id)
    && ['create', 'correct', 'retire', 'reactivate'].includes(value.action) && validTimestamp(value.recorded_at) && flags.every(key => typeof value[key] === 'boolean') && version(value.after_version));
  if (value.action === 'create') requireEvidence(value.before_version === null && value.after_version === 1);
  else requireEvidence(version(value.before_version) && value.after_version === value.before_version + Number(flags.some(key => value[key])));
  return value;
}
export const historyPage = value => cursorPage(value, historyRecord);
export const displayText = value => nonblank(value) ? value : 'Not recorded';
export const parentText = value => value.parent_id === null ? 'No direct parent' : value.parent === null ? 'Recorded parent unavailable' : `${displayText(value.parent.name)} (${displayText(value.parent.code)})`;
export const errorCopy = error => ({
  inventory_category_referenced: 'A retained item or current child still references this category, including inactive or malformed references. Active state can change only for unused categories.',
  inventory_category_version_conflict: 'This category or selected parent changed after review. Refresh and review current revisions.',
  inventory_category_request_conflict: 'This request identifier belongs to another reviewed change. Check the original result.',
  inventory_category_code_conflict: 'This permanent code already identifies a category, including retired categories. Choose another code.',
  inventory_category_source_unavailable: 'The selected parent or its retained ancestor chain is unavailable. Refresh and explicitly review a valid local parent.',
  inventory_category_not_found: 'The exact category or original result is unavailable.',
  inventory_category_busy: 'Another operation is using this category or request. Keep the original request and check its result.',
  invalid_inventory_category_command: 'The server could not admit the reviewed text or parent relationship. Refresh and review supported input.',
  reauth_required: 'Confirm current credentials before this protected action, then refresh and review.',
}[error?.data?.error?.code] || 'Current category evidence could not be confirmed. Refresh and review before continuing.');
