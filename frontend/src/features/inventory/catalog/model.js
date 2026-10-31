const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META = ['code', 'name', 'unit'];
const ITEM_FIELDS = ['id', 'category_id', 'category', ...META, 'item_type', 'controlled', 'effective_controlled', 'is_active', 'version', 'catalog_changed_at', 'created_at'];
const BLOCKERS = [null, 'controlled_or_unsupported', 'operational_reference'];
const own = (value, key) => Object.hasOwn(value, key);
export const exact = (value, fields) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(key => own(value, key)));
export const validId = value => typeof value === 'string' && UUID.test(value) && value !== '00000000-0000-0000-0000-000000000000';
const version = value => Number.isSafeInteger(value) && value > 0;
const string = value => typeof value === 'string';
const nonblank = value => string(value) && value.trim().length > 0;
export const invalidEvidence = () => new Error('Current catalog evidence could not be confirmed. Refresh and review before continuing.');
const requireEvidence = condition => { if (!condition) throw invalidEvidence(); };
const clone = value => structuredClone(value);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

// Chrono accepts signed/expanded years. Do not narrow receipts to browser date
// input syntax, or compare a publication stamp with unrelated legacy clocks.
function dateParts(value) {
  if (!string(value)) return null;
  const match = /^([+-]?\d{4,})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (!Number.isSafeInteger(year) || month < 1 || month > 12) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return null;
  const magnitude = String(Math.abs(year)).padStart(4, '0');
  return { year, month, day, canonical: `${year < 0 ? '-' : year > 9999 ? '+' : ''}${magnitude}-${match[2]}-${match[3]}` };
}
export const validReviewedDate = value => { const parts = dateParts(value); return Boolean(parts && parts.canonical === value); };
export const utcToday = () => new Date().toISOString().slice(0, 10);
const after = (left, right) => left.year > right.year || (left.year === right.year && (left.month > right.month || (left.month === right.month && left.day > right.day)));
export function validTimestamp(value) {
  if (!string(value)) return false;
  const match = /^(.+)T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  return Boolean(match && dateParts(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) <= 60
    && (match[5] === 'Z' || (Number(match[5].slice(1, 3)) < 24 && Number(match[5].slice(4)) < 60)));
}
function wellFormed(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const next = value.charCodeAt(++index); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
export const validNewText = value => nonblank(value) && value.trim() === value && wellFormed(value) && [...value].length <= 120
  && new TextEncoder().encode(value).length <= 480 && ![...value].some(char => { const code = char.codePointAt(0); return code < 32 || (code >= 127 && code <= 159); });
export function normalizeNewText(value) {
  if (!string(value) || !validNewText(value.trim())) throw new Error('Use a nonblank value of up to 120 characters and 480 UTF-8 bytes without control characters.');
  return value.trim();
}
export const ordinaryItem = item => Boolean(item && item.effective_controlled === false && ['medication', 'supply'].includes(item.item_type));
export function itemState(value, id = null) {
  requireEvidence(exact(value, ITEM_FIELDS) && validId(value.id) && (id === null || value.id === id) && validId(value.category_id)
    && META.every(key => string(value[key])) && string(value.item_type) && typeof value.controlled === 'boolean'
    && typeof value.effective_controlled === 'boolean' && value.effective_controlled === (value.controlled || value.item_type === 'controlled_substance')
    && typeof value.is_active === 'boolean' && version(value.version) && validTimestamp(value.created_at)
    && (value.catalog_changed_at === null || validTimestamp(value.catalog_changed_at)));
  if (value.category !== null) requireEvidence(exact(value.category, ['id', 'code', 'name']) && value.category.id === value.category_id && string(value.category.code) && string(value.category.name));
  return value;
}
export function itemDetail(value, id = null) {
  requireEvidence(exact(value, ['item', 'eligibility']) && exact(value.eligibility, ['unit_change_blocked_by', 'lifecycle_blocked_by'])
    && BLOCKERS.includes(value.eligibility.unit_change_blocked_by) && BLOCKERS.includes(value.eligibility.lifecycle_blocked_by));
  itemState(value.item, id); return value;
}
function cursorPage(value, validate, identity) {
  const page = value?.page;
  // Keep the actual transport envelope and its opaque metadata. Metadata does
  // not establish read authority; publication still requires the response lease.
  requireEvidence(exact(value, ['data', 'page', 'meta']) && value.meta !== null && typeof value.meta === 'object' && !Array.isArray(value.meta)
    && exact(page, ['has_next', 'next_cursor', 'limit']) && Array.isArray(value.data)
    && typeof page.has_next === 'boolean' && Number.isSafeInteger(page.limit) && page.limit > 0 && page.limit <= 100 && value.data.length <= page.limit
    && (page.has_next ? nonblank(page.next_cursor) : page.next_cursor === null));
  value.data.forEach(validate);
  requireEvidence(new Set(value.data.map(identity)).size === value.data.length); return value;
}
export const itemPage = value => cursorPage(value, row => itemState(row), row => row.id);
export function categoryState(value) { requireEvidence(exact(value, ['id', 'code', 'name']) && validId(value.id) && string(value.code) && string(value.name)); return value; }
export const categoryPage = value => cursorPage(value, categoryState, row => row.id);

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
export function reviewedInput(value, previous = null) {
  const base = ['action', 'client_request_id'];
  requireEvidence(validId(value?.client_request_id));
  if (value.action === 'create') {
    requireEvidence(exact(value, [...base, 'category_id', ...META, 'item_type']) && validId(value.category_id)
      && META.every(key => validNewText(value[key])) && ['medication', 'supply'].includes(value.item_type));
  } else if (['correct', 'retire', 'reactivate'].includes(value.action)) {
    requireEvidence(exact(value, [...base, 'item_id', 'expected_version', ...(value.action === 'correct' ? [...META, 'effective_from', 'reason'] : [])])
      && validId(value.item_id) && version(value.expected_version));
    if (previous) { itemState(previous, value.item_id); requireEvidence(previous.version === value.expected_version); }
    if (value.action === 'correct') {
      requireEvidence(META.every(key => string(value[key]) && (!previous || value[key] === previous[key] || validNewText(value[key])))
        && validReviewedDate(value.effective_from) && validNewText(value.reason) && (!previous || value.unit === previous.unit || ordinaryItem(previous)));
    }
  } else throw invalidEvidence();
  return value;
}
export function normalizeInput(input, previous = null, { today = utcToday() } = {}) {
  const value = clone(input);
  // Check the closed shape before any normalization; unsupported fields are not
  // silently discarded into a different command.
  if (value?.action === 'create') {
    requireEvidence(exact(value, ['action', 'client_request_id', 'category_id', ...META, 'item_type']));
    META.forEach(key => { value[key] = normalizeNewText(value[key]); });
  } else if (value?.action === 'correct') {
    requireEvidence(exact(value, ['action', 'client_request_id', 'item_id', 'expected_version', ...META, 'effective_from', 'reason']));
    itemState(previous, value.item_id);
    META.forEach(key => { if (value[key] !== previous[key]) value[key] = normalizeNewText(value[key]); });
    value.reason = normalizeNewText(value.reason);
    const date = dateParts(value.effective_from), current = dateParts(today);
    if (!date || !current || after(date, current)) throw new Error('Choose today or an earlier reviewed date. The server confirms date admission.');
    value.effective_from = date.canonical;
    requireEvidence(value.unit === previous.unit || ordinaryItem(previous));
  }
  reviewedInput(value, previous); return value;
}
export async function prepareCommand(input, actorId, previous = null, options) {
  // Both intent and its reviewed source are copied before asynchronous hashing.
  const snapshot = { input: clone(input), actorId, previous: previous === null ? null : clone(previous) };
  requireEvidence(validId(actorId)); snapshot.input = normalizeInput(snapshot.input, snapshot.previous, options);
  if (snapshot.input.action === 'create') requireEvidence(snapshot.previous === null);
  if (snapshot.input.action !== 'create') requireEvidence(snapshot.previous && itemState(snapshot.previous, snapshot.input.item_id).version === snapshot.input.expected_version);
  if (['retire', 'reactivate'].includes(snapshot.input.action)) requireEvidence(ordinaryItem(snapshot.previous));
  snapshot.digest = await inputDigest(snapshot.input); return freeze(snapshot);
}
export async function validateCommand(command) {
  const value = clone(command);
  requireEvidence(exact(value, ['input', 'actorId', 'previous', 'digest']) && validId(value.actorId));
  reviewedInput(value.input, value.previous);
  if (value.input.action === 'create') requireEvidence(value.previous === null);
  if (['retire', 'reactivate'].includes(value.input.action)) requireEvidence(ordinaryItem(value.previous));
  if (value.input.action !== 'create') requireEvidence(value.previous && itemState(value.previous, value.input.item_id).version === value.input.expected_version);
  requireEvidence(value.digest === await inputDigest(value.input)); return freeze(value);
}
function metadata(value) { requireEvidence(exact(value, [...META, 'version']) && META.every(key => string(value[key])) && version(value.version)); return value; }
const projectionChanged = (before, next) => META.some(key => before[key] !== next[key]);
function revision(value) {
  requireEvidence(exact(value, ['id', 'reviewed_effective_from', 'recorded_at', 'before', 'after', 'projection_changed']) && validId(value.id)
    && validReviewedDate(value.reviewed_effective_from) && validTimestamp(value.recorded_at) && typeof value.projection_changed === 'boolean');
  metadata(value.before); metadata(value.after);
  requireEvidence(value.projection_changed === projectionChanged(value.before, value.after) && value.after.version === value.before.version + (value.projection_changed ? 1 : 0));
  return value;
}
export async function commandReceipt(value, { requestId, actorId, input = null, previous = null } = {}) {
  const receipt = clone(value ?? null), expectedInput = input === null ? null : clone(input), prior = previous === null ? null : clone(previous);
  requireEvidence(exact(receipt, ['client_request_id', 'input_digest', 'reviewed_input', 'recorded_by_user_id', 'item', 'changed', 'recorded_at', 'correction_revision'])
    && validId(requestId) && validId(actorId) && receipt.client_request_id === requestId && receipt.recorded_by_user_id === actorId
    && /^[0-9a-f]{64}$/.test(receipt.input_digest) && typeof receipt.changed === 'boolean' && validTimestamp(receipt.recorded_at));
  const command = reviewedInput(receipt.reviewed_input), item = itemState(receipt.item);
  requireEvidence(command.client_request_id === requestId && (!expectedInput || same(command, reviewedInput(expectedInput, prior))));
  if (command.action === 'create') {
    requireEvidence(prior === null && receipt.changed && receipt.correction_revision === null && item.version === 1 && item.is_active && !item.controlled && !item.effective_controlled
      && item.item_type === command.item_type && item.category_id === command.category_id && META.every(key => item[key] === command[key]));
  } else {
    requireEvidence(item.id === command.item_id && item.version === command.expected_version + (receipt.changed ? 1 : 0));
    if (command.action === 'correct') {
      const change = revision(receipt.correction_revision);
      requireEvidence(change.reviewed_effective_from === command.effective_from && change.recorded_at === receipt.recorded_at
        && change.before.version === command.expected_version && change.after.version === item.version && change.projection_changed === receipt.changed
        && (change.before.unit === change.after.unit || ordinaryItem(item))
        && META.every(key => item[key] === command[key] && change.after[key] === item[key] && (command[key] === change.before[key] || validNewText(command[key]))));
      if (prior) requireEvidence(META.every(key => change.before[key] === prior[key]));
    } else requireEvidence(receipt.correction_revision === null && ordinaryItem(item) && item.is_active === (command.action === 'reactivate'));
    if (prior) {
      itemState(prior, command.item_id);
      requireEvidence(prior.version === command.expected_version && ['category_id', 'item_type', 'controlled', 'effective_controlled', 'created_at'].every(key => item[key] === prior[key])
        && (command.action === 'correct' ? item.is_active === prior.is_active && receipt.changed === projectionChanged(prior, item)
          : META.every(key => item[key] === prior[key]) && receipt.changed === (item.is_active !== prior.is_active))
        && (receipt.changed || item.catalog_changed_at === prior.catalog_changed_at));
    }
  }
  requireEvidence(await inputDigest(command) === receipt.input_digest); return freeze(receipt);
}
export function historyRecord(value) {
  requireEvidence(typeof value?.reason_present === 'boolean' && validId(value.id) && validTimestamp(value.recorded_at));
  if (value.source === 'legacy_dated_version') {
    requireEvidence(exact(value, ['source', 'id', 'effective_from', 'effective_to', ...META, 'recorded_at', 'reason_present'])
      && validReviewedDate(value.effective_from) && (value.effective_to === null || validReviewedDate(value.effective_to)) && META.every(key => string(value[key])));
  } else if (value.source === 'governed_correction') {
    requireEvidence(exact(value, ['source', 'id', 'reviewed_effective_from', 'recorded_at', 'before', 'after', 'projection_changed', 'reason_present']));
    const { source: _source, reason_present: _reason, ...change } = value; revision(change);
  } else throw invalidEvidence();
  return value;
}
export const historyPage = value => cursorPage(value, historyRecord, row => `${row.source}:${row.id}`);
export const displayText = value => nonblank(value) ? value : 'Not recorded';
const errorMessages = new Map(Object.entries({
  inventory_item_has_operational_history: 'This item has linked records. Zero stock or completed work does not remove linked records. Refresh and review this action again.',
  inventory_item_controlled_or_unsupported: 'This classification cannot change active state or stock unit in this workflow. Unchanged-unit metadata correction follows its separate rules.',
  inventory_item_version_conflict: 'The current catalog changed after your review. Refresh and review its current revision.',
  inventory_item_request_conflict: 'This request identifier belongs to a different reviewed change. Check the original result.',
  inventory_item_code_conflict: 'This code is currently assigned to another item. Choose a different code.',
  inventory_item_busy: 'Another operation is using this item or request. Keep the original request and check its result.',
  inventory_item_not_found: 'The exact catalog item or original result is unavailable.',
  inventory_item_source_unavailable: 'The item or selected category is no longer available in the current configuration. Refresh and explicitly review its current source.',
  invalid_inventory_item_command: 'The server could not admit the reviewed fields or date. Refresh and review the supported exact input before submitting again.',
  reauth_required: 'Confirm current credentials before this protected action, then refresh and review.',
}));
export const errorCopy = error => errorMessages.get(error?.data?.error?.code) || 'Current catalog evidence could not be confirmed. Refresh and review before continuing.';
