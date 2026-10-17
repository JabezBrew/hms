// Loaded only for exact referral response recovery. This is a client recovery
// protocol, never authorization, a saved receipt, or a clinical write grant.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stamps = new WeakMap(); const proofs = new WeakMap(); let sequence = 0; let denialEpoch = 0; const contexts = new Map();
const failure = () => new Error('The earlier save may have finished. Review the current saved response again before continuing.');
const primary = scope => `referral-response:${scope.patientId}:${scope.referralId}`.toLowerCase();
const validScope = scope => UUID.test(scope?.patientId) && UUID.test(scope?.referralId);
const sameScope = (left, right) => left.patientId === right.patientId && left.referralId === right.referralId;
async function contentHash(value) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))); return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function captureRead(kind, scope, versionId) {
  return async (envelope, transport) => {
    const data = envelope?.data;
    if (!data || typeof data !== 'object' || data.patient_id !== scope.patientId || data.referral_id !== scope.referralId || !transport.scope || transport.isCurrent?.() === false || transport.isReadCurrent?.() !== true) return;
    if ((kind === 'version' && data.id !== versionId) || !Number.isSafeInteger(data.version) || data.version < 0) return;
    const started = ++sequence, epoch = denialEpoch;
    const hash = await contentHash(data);
    if (transport.isCurrent?.() === false || transport.isReadCurrent() !== true || epoch !== denialEpoch) return;
    // No body or credentials are retained here; the object key is weak and the value
    // holds only source identity/version/hash and opaque authority metadata.
    const key = primary(scope); let current = contexts.get(key);
    if (current?.observedSequence > started) return;
    if (kind === 'context') {
      if (!current || current.hash !== hash) { current = { hash, generation: ++sequence }; contexts.set(key, current); }
      current.observedSequence = started;
      if (contexts.size > 32) { contexts.clear(); denialEpoch++; contexts.set(key, current); }
    }
    stamps.set(data, { denialEpoch, contextGeneration: current?.generation, ...transport, principal: undefined, kind, ...scope, versionId: kind === 'version' ? versionId : data.response?.id ?? null, version: data.version, contextToken: kind === 'context' ? data.context_token : null, hash, sequence: started });
  };
}
export function classifyReferralResponseWriteScope(path) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);
  if (parts.length < 7 || parts[0] !== 'api' || parts[1] !== 'v2' || parts[2] !== 'patients' || !UUID.test(parts[3]) || parts[4] !== 'referrals' || !UUID.test(parts[5]) || parts[6] !== 'response') return null;
  const scope = { patientId: parts[3], referralId: parts[5] };
  const result = { family: 'referral-response', primary: primary(scope), extraReference: primary(scope), excludeRead: true, denyRead: () => { denialEpoch++; } };
  if (parts.length === 7) return { ...result, captureRead: captureRead('context', scope) };
  if (parts.length === 8 && parts[7] === 'history') return result;
  if (parts.length === 8 && parts[7] === 'commands') return { ...result, retryTemplate: 'POST /api/v2/patients/:id/referrals/:id/response/commands' };
  if (parts.length === 9 && UUID.test(parts[8]) && parts[7] === 'versions') return { ...result, captureRead: captureRead('version', scope, parts[8]) };
  if (parts.length === 9 && UUID.test(parts[8]) && parts[7] === 'requests') return { ...result, excludeRead: false, receiptRequestId: parts[8], receiptMatches: (envelope, principal) => envelope?.data?.client_request_id === parts[8] && envelope.data.response?.patient_id === scope.patientId && envelope.data.response.referral_id === scope.referralId && envelope.data.response.recorded_by_user_id === principal?.id };
  return null;
}
async function matching(scope, store) {
  if (!validScope(scope)) throw failure();
  const state = store.current();
  if (!state.scope || !state.context?.authority || !state.context?.transport) throw failure();
  const [family, reference] = await Promise.all([store.digest('family:referral-response'), store.digest(`reference:${primary(scope)}`)]);
  return { ...state, entries: store.load().entries.filter(entry => entry.scope === state.scope && entry.family === family && entry.primary_reference === reference && !store.active(entry.id)) };
}
function currentStamp(stamp, state) { return stamp && stamp.denialEpoch === denialEpoch && stamp.contextGeneration === contexts.get(primary(stamp))?.generation && stamp.scope === state.scope && stamp.authority === state.context?.authority && stamp.transport === state.context?.transport && stamp.isCurrent?.() !== false && stamp.isReadCurrent?.() === true; }
const sameAuthority = (left, right) => left.scope === right.scope && left.context?.authority === right.context?.authority && left.context?.transport === right.context?.transport;
const includesEvidence = (stamp, entry) => stamp.evidence?.some(value => value.id === entry.id && value.uncertainty_id === entry.uncertainty_id);
async function checkedStamp(data, kind, scope, state) {
  const stamp = stamps.get(data);
  if (!stamp || stamp.kind !== kind || !sameScope(stamp, scope) || !currentStamp(stamp, state) || await contentHash(data) !== stamp.hash || !currentStamp(stamp, state)) throw failure();
  return stamp;
}
export async function referralManualProtocol(action, input, store, protocol = 'response') {
  if (protocol === 'consultation') return consultationManualProtocol(action, input, store);
  if (protocol !== 'response') throw failure();
  if (action === 'cancel') { proofs.delete(input.proof); return; }
  if (action === 'candidate') return (await matching(input.scope, store)).entries.length === 1;
  if (action === 'prepare') {
    const state = await matching(input.scope, store); if (state.entries.length !== 1) throw failure();
    const entry = state.entries[0]; const context = await checkedStamp(input.context, 'context', input.scope, state);
    if (!includesEvidence(context, entry)) throw failure();
    if (context.versionId === null) { if (input.version !== null || context.version !== 0) throw failure(); }
    else {
      const version = await checkedStamp(input.version, 'version', input.scope, state);
      if (version.versionId !== context.versionId || version.version !== context.version || context.sequence <= version.sequence || !includesEvidence(version, entry)) throw failure();
    }
    if (!sameAuthority(state, store.current()) || !currentStamp(context, state) || (context.versionId !== null && !currentStamp(stamps.get(input.version), state)) || store.active(entry.id)) throw failure();
    const proof = Object.freeze({});
    proofs.set(proof, { entryId: entry.id, uncertaintyId: entry.uncertainty_id, ...input.scope, scope: state.scope, authority: state.context.authority, transport: state.context.transport, versionId: context.versionId, version: context.version, contextToken: context.contextToken, sequence: context.sequence, denialEpoch, contextGeneration: context.contextGeneration, isCurrent: context.isCurrent, isReadCurrent: context.isReadCurrent });
    return proof;
  }
  if (action === 'acknowledge') return store.queue(async () => {
    const proof = proofs.get(input.proof); proofs.delete(input.proof);
    if (!proof || !validScope(input.scope) || !sameScope(proof, input.scope)) throw failure();
    const state = await matching(input.scope, store); const entry = state.entries.find(value => value.id === proof.entryId && value.uncertainty_id === proof.uncertaintyId);
    if (!entry || proof.denialEpoch !== denialEpoch || proof.contextGeneration !== contexts.get(primary(proof))?.generation || proof.scope !== state.scope || proof.authority !== state.context.authority || proof.transport !== state.context.transport || proof.isCurrent?.() === false || proof.isReadCurrent?.() !== true) throw failure();
    // A separate explicit acknowledgment requires another actual current read.
    // A failed/current403 read cannot supply this new transport-only stamp.
    const current = await checkedStamp(input.context, 'context', input.scope, state);
    if (current.sequence <= proof.sequence || current.contextToken !== proof.contextToken || current.version !== proof.version || current.versionId !== proof.versionId || !includesEvidence(current, entry)) throw failure();
    if (!sameAuthority(state, store.current()) || proof.denialEpoch !== denialEpoch || proof.contextGeneration !== contexts.get(primary(proof))?.generation || proof.isCurrent?.() === false || proof.isReadCurrent?.() !== true || !currentStamp(current, state) || store.active(entry.id) || !store.load().entries.some(value => value.id === proof.entryId && value.uncertainty_id === proof.uncertaintyId)) throw failure();
    store.remove(proof.entryId, proof.uncertaintyId);
  });
  throw failure();
}

// Route selection remains lazy and exact; the established response protocol and
// its synchronous classifier keep their existing interface and predicates.
export async function classifyReferralWriteScope(path) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);
  if (parts[6] === 'consultation') return (await import('./consultationWriteScopes')).classifyConsultationWriteScope(path);
  return classifyReferralResponseWriteScope(path);
}
export async function consultationManualProtocol(...args) {
  return (await import('./consultationWriteScopes')).consultationManualProtocol(...args);
}
