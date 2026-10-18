import { apiErrorFromEnvelope } from './errors';

export const WRITE_UNCERTAINTY_KEY = 'hms.v2.write-review.v1';
const MAX_ENTRIES = 24; const MAX_BYTES = 24000; const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/; const receiptKey = Symbol('write-review');
const ROOTS = new Set(['admin', 'auth', 'billing', 'clinical', 'encounters', 'inventory', 'laboratory', 'nhis', 'nursing', 'patients', 'pharmacy', 'scheduling', 'visits', 'wards', 'appointments']);
const FAMILY_ALIASES = { 'nursing/prn-dose-requests': 'nursing/medication-administrations', 'nursing/prn-orders': 'nursing/medication-administrations', 'nhis/batches': 'nhis/claims', 'nhis/exports': 'nhis/claims', 'inventory/catalog-edits': 'inventory/items' };
let store; let fault = false; let currentScope = null; let currentContext = null; let activation = 0; let serial = Promise.resolve();
const active = new Map(); const subscribers = new Set();
let snapshot = { entries: [], unavailable: false };
const readDispatch = new WeakMap(), readReviews = new WeakMap(), readResponses = new WeakMap(); let readOrder = 0; let lastReadDenial = 0;
const error = (code = 'write_review_required', message = 'A previous change needs review before a new change can be submitted. Open and refresh the affected workflow, review its saved records, then acknowledge the recovery notice.') => apiErrorFromEnvelope(409, { error: { code, message } });
function publish() { snapshot = { entries: (store?.entries || []).filter((entry) => entry.scope === currentScope && (!active.has(entry.id) || entry.state === 'uncertain' || active.get(entry.id).some((handle) => handle.authority !== currentContext?.authority || handle.transport !== currentContext?.transport))).map(({ id, operation, created_at, reviewed_at }) => ({ id, operation, created_at, reviewed: Boolean(reviewed_at) })), unavailable: fault }; subscribers.forEach((notify) => notify()); }
export const subscribeWriteUncertainty = (notify) => { subscribers.add(notify); return () => subscribers.delete(notify); };
export const getWriteUncertaintySnapshot = () => snapshot;
function persist() {
  try { const value = JSON.stringify(store); if (value.length > MAX_BYTES || store.entries.length > MAX_ENTRIES) throw error(); sessionStorage.setItem(WRITE_UNCERTAINTY_KEY, value); }
  catch { fault = true; publish(); throw error('write_review_storage_unavailable'); }
  publish();
}
function load() {
  if (fault) throw error('write_review_storage_unavailable');
  if (store) return store;
  try {
    const raw = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    if (raw) {
      if (raw.length > MAX_BYTES) throw error();
      const candidate = JSON.parse(raw);
      if (candidate?.version !== 1 || !UUID.test(candidate.salt) || !Array.isArray(candidate.entries) || candidate.entries.length > MAX_ENTRIES
        || candidate.entries.some((entry) => !UUID.test(entry.id) || !UUID.test(entry.uncertainty_id) || !HEX.test(entry.scope) || !HEX.test(entry.fingerprint) || !HEX.test(entry.family) || !(entry.primary_reference == null || HEX.test(entry.primary_reference)) || !Array.isArray(entry.references) || entry.references.length > 100 || entry.references.some((hash) => !HEX.test(hash)) || !/^(POST|PUT|PATCH|DELETE) \/api\/v2\/(admin|auth|billing|clinical|encounters|inventory|laboratory|nhis|nursing|patients|pharmacy|scheduling|visits|wards|appointments|workflow)\/:workflow$/.test(entry.operation) || !['pending', 'uncertain'].includes(entry.state) || !Number.isFinite(entry.created_at) || !Number.isFinite(entry.uncertain_at) || !(entry.uuid === null || UUID.test(entry.uuid)) || !(entry.reviewed_at === null || Number.isFinite(entry.reviewed_at)))) throw error();
      // A response reviewed in an earlier page lifetime is not a fresh review.
      store = { ...candidate, entries: candidate.entries.map((entry) => ({ ...entry, reviewed_at: null })) };
    } else { store = { version: 1, salt: crypto.randomUUID(), entries: [] }; persist(); }
    return store;
  } catch { fault = true; publish(); throw error('write_review_storage_unavailable'); }
}
async function digest(value) {
  if (!crypto.subtle) { fault = true; publish(); throw error('write_review_storage_unavailable'); }
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${load().salt}:${value}`)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const principalScope = (principal) => [principal?.id, principal?.facility_id || principal?.facility_code, principal?.active_profile];
async function scopeFor(principal) { const identity = principalScope(principal); if (identity.some((value) => typeof value !== 'string' || !value)) throw error('write_review_scope_unconfirmed'); return digest(JSON.stringify(identity)); }
export function activateWriteUncertainty(principal, context = null) {
  const request = ++activation; currentScope = null; currentContext = context; publish();
  if (!principal?.id) return;
  scopeFor(principal).then((scope) => { if (activation === request) { currentScope = scope; for (const entry of store.entries) if (entry.scope === scope) entry.reviewed_at = null; publish(); } }).catch(() => {});
}


const references = async (...values) => (await import('./writeReplayPolicy')).referenceHashes(digest, ...values);
async function admissionScope(request) {
  try { return await (await import('./writeScopeRouter')).classifyWriteScope(request); }
  catch { throw error('write_review_check_unavailable', 'The workflow safety check could not load. No change was submitted. Reload and try again.'); }
}
function primaryReference(request) { for (const key of ['admission_case_id', 'patient_id']) for (const source of [request.body, request.query, request.pathParams]) if (UUID.test(source?.[key])) return source[key]; if (UUID.test(request.pathParams?.id)) return request.pathParams.id; return UUID.test(request.body?.item_id) ? request.body.item_id : null; }

function family(path) { const parts = String(path).split('?')[0].split('/').filter(Boolean); if (parts[0] !== 'api') parts.unshift('api', 'v2'); const alias = FAMILY_ALIASES[parts.slice(2, 4).join('/')]; return alias ? `api/v2/${alias}` : parts.slice(0, 4).map((part) => UUID.test(part) ? part.toLowerCase() : part).join('/'); }

const queue = (work) => { const next = serial.then(work, work); serial = next.catch(() => {}); return next; };
export async function beginWriteAttempt(request, context) {
  // Only the mounted Rust authority boundary enables this transport layer.
  if (!context.principal?.id) return null;
  return queue(async () => {
    const scope = await scopeFor(context.principal); const method = request.method.toUpperCase();
    const [admission, replayPolicy] = await Promise.all([admissionScope(request), import('./writeReplayPolicy')]);
    const { route, replayable, input } = replayPolicy.prepareWriteIntent(request, method);
    const primary = admission?.primary || primaryReference(request);
    const [fingerprint, referenceHashes, familyHash, primaryHash] = await Promise.all([digest(input), references(request.body, request.pathParams, request.query), digest(`family:${admission?.family || family(request.resolvedPath)}`), primary ? digest(`reference:${primary.toLowerCase()}`) : null]);
    const uuid = replayable && (replayPolicy.supportsCommandReplay(method, route) || admission?.retryTemplate === `${method} ${route}`) && UUID.test(request.body?.client_request_id) ? request.body.client_request_id : null;
    const unresolved = load().entries.filter((entry) => entry.scope === scope && (entry.state === 'uncertain' || !active.has(entry.id) || active.get(entry.id).some((live) => live.authority !== context.authority || live.transport !== context.transport)));
    const exact = unresolved.find((entry) => uuid && entry.uuid === uuid && entry.fingerprint === fingerprint);
    if (unresolved.length && (!exact || unresolved.some((entry) => entry.id !== exact.id))) throw error();
    if (exact && active.has(exact.id)) throw error();
    if (!exact && load().entries.length >= MAX_ENTRIES) throw error('write_review_storage_full');
    const root = String(request.path).split('/').filter(Boolean)[2];
    const entry = exact || { id: crypto.randomUUID(), uncertainty_id: crypto.randomUUID(), scope, operation: `${method} /api/v2/${ROOTS.has(root) ? root : 'workflow'}/:workflow`, uuid, fingerprint, family: familyHash, primary_reference: primaryHash, references: referenceHashes, created_at: Date.now(), uncertain_at: Date.now(), reviewed_at: null, state: 'pending' };
    const handle = { entry: { ...entry }, previous: Boolean(exact), authority: context.authority, transport: context.transport };
    if (!exact) { if (JSON.stringify({ ...store, entries: [...store.entries, entry] }).length > MAX_BYTES) throw error('write_review_storage_full'); store.entries.push(entry); }
    active.set(entry.id, [...(active.get(entry.id) || []), handle]); persist(); return handle;
  });
}
export function assertWriteAttemptDispatchAllowed(handle) {
  if (!handle) return;
  if (load().entries.some((entry) => entry.id !== handle.entry.id && entry.scope === handle.entry.scope && (entry.state === 'uncertain' || !active.has(entry.id) || active.get(entry.id).some((live) => live.authority !== handle.authority || live.transport !== handle.transport)))) throw error();
}
function finish(handle) { if (!handle) return; const remaining = (active.get(handle.entry.id) || []).filter((item) => item !== handle); if (remaining.length) active.set(handle.entry.id, remaining); else active.delete(handle.entry.id); }
function remove(handle) { if (!handle) return; load(); store.entries = store.entries.filter((entry) => entry.id !== handle.entry.id || entry.fingerprint !== handle.entry.fingerprint); persist(); }
function attach(response, handle) { if (!response || typeof response !== 'object' || !handle) return; for (const value of [response, response.data]) if (value && typeof value === 'object' && Object.isExtensible(value)) Object.defineProperty(value, receiptKey, { value: handle, configurable: true }); }
export const attachWriteResponseMetadata = attach;
// Preserve only the opaque attempt handle when a typed adapter wraps an error.
// A validated immutable receipt can then acknowledge that exact original write.
export function copyWriteResponseMetadata(target, source) { attach(target, source?.[receiptKey]); return target; }
export function confirmWriteAttempt(handle, response) { if (!handle) return; finish(handle); attach(response, handle); remove(handle); }
export function rejectWriteAttempt(handle) { if (!handle) return; finish(handle); if (!handle.previous) remove(handle); else publish(); }
export function markWriteAttemptUncertain(handle) {
  if (!handle) return; finish(handle); load(); const old = store.entries.find((entry) => entry.id === handle.entry.id);
  const entry = { ...(old || handle.entry), uncertainty_id: crypto.randomUUID(), state: 'uncertain', uncertain_at: Date.now(), reviewed_at: null };
  if (old) Object.assign(old, entry); else { if (store.entries.length >= MAX_ENTRIES) { fault = true; publish(); throw error('write_review_storage_full'); } store.entries.push(entry); }
  persist();
}
export function markWriteResponseUncertain(response) { markWriteAttemptUncertain(response?.[receiptKey]); }
export function acknowledgeWriteResponse(response) {
  const handle = response?.[receiptKey]; if (!handle) return;
  const entry = load().entries.find(value => value.id === handle.entry.id);
  // A retained error is not fresh receipt evidence. Reconciliation must still
  // own the actual read lease and exact uncertainty identity at acknowledgment.
  if (entry && !readReviews.get(entry)?.()) throw error();
  remove(handle);
}
export function captureWriteRecoveryRead() { try { const evidence = load().entries.filter((entry) => !active.has(entry.id)).map(({ id, uncertainty_id }) => ({ id, uncertainty_id })); const order = ++readOrder, epoch = activation, scope = currentScope; readDispatch.set(evidence, () => order > lastReadDenial && epoch === activation && scope === currentScope); return evidence; } catch { return []; } }
// Only an actual transport response can carry a receipt-display lease. This
// does not grant saved-record review or acknowledge an unknown command.
export function assertWriteRecoveryReadCurrent(response) {
  load();
  if (!readResponses.get(response)?.()) throw error();
}
export function invalidateWriteRecoveryReads() {
  lastReadDenial = ++readOrder;
  // A newer denial invalidates published review as well as pending dispatches.
  // Keep every opaque unknown-write marker until a fresh authorized review.
  let changed = false;
  for (const entry of load().entries) {
    if (entry.scope === currentScope && entry.reviewed_at !== null) {
      entry.reviewed_at = null; changed = true;
    }
  }
  if (changed) persist();
}
export async function recordWriteRecoveryRead(request, response, context) {
  if (context.isCurrentScope?.() === false) return;
  if (context.denied) {
    invalidateWriteRecoveryReads();
  } else if (response && typeof response === 'object') {
    const lease = readDispatch.get(context.readEvidence);
    readResponses.set(response, () => context.isCurrentScope?.() !== false && lease?.() === true
      && context.readEvidence.every(proof => load().entries.some(entry => entry.id === proof.id && entry.uncertainty_id === proof.uncertainty_id && !active.has(entry.id))));
  }
  if ((!context.denied && !context.readEvidence?.length) || !load().entries.length) return;
  return (await import('./writeRecoveryRead')).recordRecoveryRead(request, response, context, {
    admissionScope, load, scopeFor, digest, references, family, active, persist,
    current: () => ({ scope: currentScope, context: currentContext }),
    readLease: evidence => readDispatch.get(evidence),
    review: (entry, proof) => readReviews.set(entry, proof),
  });
}
export async function acknowledgeWriteReview(id, principal) {
  return queue(async () => { const scope = await scopeFor(principal); const entry = load().entries.find((item) => item.id === id && item.scope === scope); if (scope !== currentScope || !entry?.reviewed_at || active.has(id) || !readReviews.get(entry)?.()) throw error(); store.entries = store.entries.filter((item) => item !== entry); persist(); });
}
// Every authority/transport activation invalidates earlier dispatch leases, even
// when it later returns to the same values. No clinical body is retained here.
function manualStore() {
  return { current: () => ({ scope: currentScope, context: currentContext, activation }), digest, load, queue, active: id => active.has(id),
    remove: (id, uncertaintyId) => { store.entries = load().entries.filter(entry => entry.id !== id || entry.uncertainty_id !== uncertaintyId); persist(); } };
}
// Deliberately narrow manual recovery; its lazy protocol accepts only actual
// transport-stamped current referral reads and an explicit separate gesture.
export async function referralResponseManualReview(action, input, protocol = 'response') {
  return (await import('./referralWriteScopes')).referralManualProtocol(action, input, manualStore(), protocol);
}
export async function admissionMoveManualReview(action, input) {
  return (await import('./moveWriteScopes')).moveManualProtocol(action, input, manualStore());
}
// A reload can locate only a singleton current organization command UUID. The
// original actor-bound receipt and a separate acknowledgment are still required.
export async function organizationCommandRecoveryCandidate() {
  const store = manualStore(), origin = store.current();
  return (await import('./writeScopeRouter')).organizationRecoveryCandidate(store, origin);
}
// The body never survives a reload; only an existing singleton actor UUID can be located.
export async function storageLocationCommandRecoveryCandidate() {
  const store = manualStore(), origin = store.current();
  return (await import('./writeScopeRouter')).storageLocationRecoveryCandidate(store, origin);
}
export function resetWriteUncertaintyForTests({ preserveStorage = false } = {}) { store = undefined; fault = false; currentScope = null; currentContext = null; activation += 1; active.clear(); serial = Promise.resolve(); if (!preserveStorage) sessionStorage.removeItem(WRITE_UNCERTAINTY_KEY); publish(); }
