import { receiptEvidence } from '@/features/referrals/consultations/model';
// Narrow RAM-only current-link review. Context reads never acknowledge a start.
const stamps = new WeakMap(), proofs = new WeakMap(), generations = new Map();
let sequence = 0, denialEpoch = 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key = scope => `referral-consultation:${scope.patientId}:${scope.referralId}`.toLowerCase();
const valid = scope => UUID.test(scope?.patientId) && UUID.test(scope?.referralId);
const fail = () => new Error('Review the current saved consultation link again before continuing.');
async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export const denyConsultationRead = () => { denialEpoch++; };
export function captureConsultationContext(scope) {
  return async (envelope, transport) => {
    const value = envelope?.data;
    if (!valid(scope) || value?.patient_id !== scope.patientId || value.referral_id !== scope.referralId || !/^[0-9a-f]{64}$/.test(value.context_token) || !Number.isSafeInteger(value.link_version) || ![0, 1].includes(value.link_version) || value.selection !== null || !transport.scope || transport.isCurrent?.() === false || transport.isReadCurrent?.() !== true) return;
    const started = ++sequence, epoch = denialEpoch;
    const content = await hash(value); if (transport.isCurrent?.() === false || transport.isReadCurrent() !== true || epoch !== denialEpoch) return;
    const id = key(scope); let current = generations.get(id);
    if (current?.observedSequence > started) return;
    if (!current || current.hash !== content) current = { hash: content, generation: ++sequence };
    current.observedSequence = started; generations.set(id, current);
    if (generations.size > 32) { generations.clear(); denialEpoch++; generations.set(id, current); }
    stamps.set(value, { ...transport, ...scope, hash: content, sequence: started, generation: current.generation, denialEpoch });
  };
}
const sameAuthority = (left, right) => left.scope === right.scope && left.context?.authority === right.context?.authority && left.context?.transport === right.context?.transport;
const currentStamp = (stamp, scope, state) => stamp && stamp.patientId === scope.patientId && stamp.referralId === scope.referralId && stamp.scope === state.scope && stamp.authority === state.context?.authority && stamp.transport === state.context?.transport && stamp.denialEpoch === denialEpoch && stamp.generation === generations.get(key(scope))?.generation && stamp.isCurrent?.() !== false && stamp.isReadCurrent?.() === true;
async function matching(scope, store) {
  if (!valid(scope)) throw fail();
  const state = store.current(); if (!state.scope || !state.context?.authority || !state.context?.transport) throw fail();
  const [family, reference] = await Promise.all([store.digest('family:referral-consultation'), store.digest(`reference:${key(scope)}`)]);
  return { ...state, entries: store.load().entries.filter(entry => entry.scope === state.scope && entry.family === family && entry.primary_reference === reference && !store.active(entry.id)) };
}
async function checked(value, scope, state, entry) {
  const stamp = stamps.get(value);
  if (!currentStamp(stamp, scope, state) || !stamp.evidence?.some(proof => proof.id === entry.id && proof.uncertainty_id === entry.uncertainty_id) || await hash(value) !== stamp.hash || !currentStamp(stamp, scope, state)) throw fail();
  return stamp;
}
export async function consultationManualProtocol(action, input, store) {
  if (action === 'cancel') { proofs.delete(input.proof); return; }
  if (action === 'candidate') return (await matching(input.scope, store)).entries.length === 1;
  if (action === 'prepare') {
    const state = await matching(input.scope, store); if (state.entries.length !== 1) throw fail();
    const entry = state.entries[0], stamp = await checked(input.context, input.scope, state, entry);
    if (!sameAuthority(state, store.current()) || !currentStamp(stamp, input.scope, state) || store.active(entry.id)) throw fail();
    const proof = Object.freeze({}); proofs.set(proof, { ...stamp, entryId: entry.id, uncertaintyId: entry.uncertainty_id }); return proof;
  }
  if (action === 'acknowledge') return store.queue(async () => {
    const proof = proofs.get(input.proof); proofs.delete(input.proof);
    if (!proof || !valid(input.scope) || proof.patientId !== input.scope.patientId || proof.referralId !== input.scope.referralId) throw fail();
    const state = await matching(input.scope, store), entry = state.entries.find(value => value.id === proof.entryId && value.uncertainty_id === proof.uncertaintyId);
    if (!entry || proof.scope !== state.scope || proof.authority !== state.context?.authority || proof.transport !== state.context?.transport || proof.denialEpoch !== denialEpoch || proof.generation !== generations.get(key(input.scope))?.generation || proof.isCurrent?.() === false) throw fail();
    const current = await checked(input.context, input.scope, state, entry);
    if (current.sequence <= proof.sequence || current.hash !== proof.hash || !sameAuthority(state, store.current()) || !currentStamp(proof, input.scope, state) || !currentStamp(current, input.scope, state) || store.active(entry.id) || !store.load().entries.some(value => value.id === entry.id && value.uncertainty_id === entry.uncertainty_id)) throw fail();
    store.remove(entry.id, entry.uncertainty_id);
  });
  throw fail();
}

export function classifyConsultationWriteScope(path) {
  const parts = String(path).split('?')[0].split('/').filter(Boolean);
  if (parts.length < 7 || parts[0] !== 'api' || parts[1] !== 'v2' || parts[2] !== 'patients' || !UUID.test(parts[3]) || parts[4] !== 'referrals' || !UUID.test(parts[5]) || parts[6] !== 'consultation') return null;
  const scope = { patientId: parts[3], referralId: parts[5] }, reference = key(scope);
  const base = { primary: reference, extraReference: reference, family: 'referral-consultation', excludeRead: true, denyRead: denyConsultationRead };
  if (parts.length === 7) return { ...base, captureRead: captureConsultationContext(scope) };
  if (parts.length === 8 && parts[7] === 'start') return { ...base, retryTemplate: 'POST /api/v2/patients/:id/referrals/:id/consultation/start' };
  if (parts.length === 9 && parts[7] === 'requests' && UUID.test(parts[8])) return { ...base, excludeRead: false, receiptRequestId: parts[8], receiptMatches: (response, principal) => { try { receiptEvidence(response?.data, scope, parts[8], principal?.id); return true; } catch { return false; } } };
  return null;
}
