import { apiErrorFromEnvelope } from './errors';

export const WRITE_UNCERTAINTY_KEY = 'hms.v2.write-review.v1';
const MAX_ENTRIES = 24; const MAX_BYTES = 24000; const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/; const receiptKey = Symbol('write-review');
const ROOTS = new Set(['admin', 'auth', 'billing', 'clinical', 'encounters', 'inventory', 'laboratory', 'nhis', 'nursing', 'patients', 'pharmacy', 'scheduling', 'visits', 'wards', 'appointments']);
const FAMILY_ALIASES = { 'nursing/prn-dose-requests': 'nursing/medication-administrations', 'nursing/prn-orders': 'nursing/medication-administrations', 'nhis/batches': 'nhis/claims', 'nhis/exports': 'nhis/claims', 'inventory/catalog-edits': 'inventory/items' };
const IDEMPOTENT = new Set(['POST /api/v2/nursing/fluid-observations', 'POST /api/v2/nursing/fluid-observations/:id/corrections', 'POST /api/v2/nursing/fluid-observations/:id/void', 'POST /api/v2/nursing/fluid-monitoring/rules', 'POST /api/v2/scheduling/appointment-series', 'POST /api/v2/scheduling/appointment-series/:id/cancel-future', 'POST /api/v2/nursing/prn-dose-requests', 'PUT /api/v2/admin/network-policy', 'PATCH /api/v2/clinical/prescriptions/:id/documentation', 'POST /api/v2/clinical/prescriptions/:id/new-course', 'POST /api/v2/nursing/patient-handovers', 'POST /api/v2/nursing/patient-handovers/:id/amend', 'POST /api/v2/nursing/patient-handovers/:id/void']);
let store; let fault = false; let currentScope = null; let currentContext = null; let activation = 0; let serial = Promise.resolve();
const active = new Map(); const subscribers = new Set();
let snapshot = { entries: [], unavailable: false };
const error = (code = 'write_review_required') => apiErrorFromEnvelope(409, { error: { code, message: 'A previous change needs review before a new change can be submitted. Open and refresh the affected workflow, review its saved records, then acknowledge the recovery notice.' } });
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
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])); return value; }
function identifiers(value, result = new Set(), key = '') {
  if (!value || result.size >= 100) return result;
  if (typeof value === 'string' && key !== 'client_request_id' && UUID.test(value) && /(^|_)ids?$/.test(key)) result.add(value);
  else if (value instanceof FormData) value.forEach((item, field) => identifiers(item, result, field));
  else if (Array.isArray(value)) value.forEach((item) => identifiers(item, result, key));
  else if (typeof value === 'object') Object.entries(value).forEach(([field, item]) => identifiers(item, result, field));
  return result;
}
const references = async (...values) => Promise.all([...values.reduce((found, value) => identifiers(value, found), new Set())].map((value) => digest(`reference:${value.toLowerCase()}`)));
function primaryReference(request) { for (const key of ['admission_case_id', 'patient_id']) for (const source of [request.body, request.query, request.pathParams]) if (UUID.test(source?.[key])) return source[key]; if (UUID.test(request.pathParams?.id)) return request.pathParams.id; return UUID.test(request.body?.item_id) ? request.body.item_id : null; }
function sensitive(value) { return value && typeof value === 'object' && Object.entries(value).some(([key, item]) => /password|^(access_token|refresh_token|secret|credential)$/i.test(key) || sensitive(item)); }
function family(path) { const parts = String(path).split('?')[0].split('/').filter(Boolean); if (parts[0] !== 'api') parts.unshift('api', 'v2'); const alias = FAMILY_ALIASES[parts.slice(2, 4).join('/')]; return alias ? `api/v2/${alias}` : parts.slice(0, 4).map((part) => UUID.test(part) ? part.toLowerCase() : part).join('/'); }
function template(path) { return String(path).replace(/\{[a-z_]+\}/g, ':id').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id'); }
const queue = (work) => { const next = serial.then(work, work); serial = next.catch(() => {}); return next; };
export async function beginWriteAttempt(request, context) {
  // Only the mounted Rust authority boundary enables this transport layer.
  if (!context.principal?.id) return null;
  return queue(async () => {
    const scope = await scopeFor(context.principal); const route = template(request.path); const method = request.method.toUpperCase();
    const serializable = !request.unsupportedBody && !sensitive(request.body);
    // Compare the JSON actually sent, including Date.toJSON/undefined handling.
    // Large or credential-bearing commands are never eligible for replay.
    const wireBody = serializable ? JSON.stringify(request.body ?? null) : null;
    const replayable = serializable && wireBody.length <= 1000000;
    const input = replayable ? JSON.stringify(canonical([method, request.resolvedPath, request.query || null, JSON.parse(wireBody)])) : crypto.randomUUID();
    const primary = primaryReference(request);
    const [fingerprint, referenceHashes, familyHash, primaryHash] = await Promise.all([digest(input), references(request.body, request.pathParams, request.query), digest(`family:${family(request.resolvedPath)}`), primary ? digest(`reference:${primary.toLowerCase()}`) : null]);
    const uuid = replayable && IDEMPOTENT.has(`${method} ${route}`) && UUID.test(request.body?.client_request_id) ? request.body.client_request_id : null;
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
export function acknowledgeWriteResponse(response) { const handle = response?.[receiptKey]; if (handle) remove(handle); }
export function captureWriteRecoveryRead() { try { return load().entries.filter((entry) => !active.has(entry.id)).map(({ id, uncertainty_id }) => ({ id, uncertainty_id })); } catch { return []; } }
export async function recordWriteRecoveryRead(request, response, context) {
  if (!context.principal?.id || !response || typeof response !== 'object' || !('data' in response)) return;
  if (!context.readEvidence?.length || !load().entries.length) return;
  const [scope, familyHash, related] = await Promise.all([scopeFor(context.principal), digest(`family:${family(request.resolvedPath)}`), references(request.pathParams, request.query, request.body, response.data)]); let changed = false;
  const readProofs = new Map(context.readEvidence.map((proof) => [proof.id, proof.uncertainty_id])); const relatedIds = new Set(related);
  const pathParts = String(request.resolvedPath).split('?')[0].split('/').filter(Boolean); if (pathParts[0] !== 'api') pathParts.unshift('api', 'v2');
  const collectionResponse = Array.isArray(response.data) && (pathParts.length === 4 || (pathParts.length === 5 && pathParts[4] === 'search'));
  for (const entry of load().entries) {
    if (entry.scope === scope && entry.family === familyHash && readProofs.get(entry.id) === entry.uncertainty_id && !active.has(entry.id)
      && (entry.primary_reference ? relatedIds.has(entry.primary_reference) : (collectionResponse || !entry.references.length || entry.references.some((hash) => relatedIds.has(hash))))) { entry.reviewed_at = Date.now(); changed = true; }
  }
  if (changed) persist();
}
export async function acknowledgeWriteReview(id, principal) {
  return queue(async () => { const scope = await scopeFor(principal); const entry = load().entries.find((item) => item.id === id && item.scope === scope); if (scope !== currentScope || !entry?.reviewed_at || active.has(id)) throw error(); store.entries = store.entries.filter((item) => item !== entry); persist(); });
}
export function resetWriteUncertaintyForTests({ preserveStorage = false } = {}) { store = undefined; fault = false; currentScope = null; currentContext = null; activation += 1; active.clear(); serial = Promise.resolve(); if (!preserveStorage) sessionStorage.removeItem(WRITE_UNCERTAINTY_KEY); publish(); }
