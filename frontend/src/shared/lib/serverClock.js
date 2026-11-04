// Actual response timing and validated observations remain in RAM only. They are
// deliberately absent from JSON, query keys, authority identity and storage.
const sources = new WeakMap();
const observations = new WeakMap();
let generation = 0;
let denialEpoch = 0;
// This identity distinguishes neutral invalidation for display retention only.
// It is never an authority, request owner, or serialized clock value.
let displayReadLifetime = Object.freeze({});
export const clockDisplayReadLifetime = () => displayReadLifetime;
const denialSubscribers = new Set();
export function subscribeServerClockDenials(notify) {
  denialSubscribers.add(notify);
  return () => denialSubscribers.delete(notify);
}
let activeToken = null;
export const clockNow = () => performance.now();
export const clockGeneration = () => generation;
export const clockDenialEpoch = () => denialEpoch;
export const invalidateServerClockReads = (denied = false) => {
  generation += 1;
  if (!denied) displayReadLifetime = Object.freeze({});
  if (denied) {
    denialEpoch += 1;
    // Notification can hide old observations; it creates no clock or authority.
    // A subscriber failure must never interrupt actual transport denial handling.
    for (const notify of [...denialSubscribers]) { try { notify(); } catch { /* Keep the invalidation effective for every remaining subscriber. */ } }
  }
};
export function recordServerClockResponse(value, context) {
  if (!value || typeof value !== 'object') return;
  const source = Object.freeze(context);
  sources.set(value, source);
  if (value.data && typeof value.data === 'object') sources.set(value.data, source);
}
export function serverClockSource(value) { return sources.get(value) || null; }
export function assertServerClockSource(source) {
  if (!source || source.generation !== generation || source.signal?.aborted || source.current?.() !== true) throw new DOMException('The response context changed.', 'AbortError');
  const elapsed = clockNow() - source.started;
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('Current server time could not be confirmed. Refresh the session.');
  return elapsed;
}
export function bindServerClock(value, observation) { if (value && typeof value === 'object') observations.set(value, observation); }
export const serverClock = value => observations.get(value) || null;
export function transferServerClock(source, target) {
  if (!target || typeof target !== 'object') return target;
  const observation = observations.get(source); const transport = sources.get(source);
  if (observation) observations.set(target, observation);
  if (transport) sources.set(target, transport);
  return target;
}

export function projectAuthSecurity(value) {
  if (!value || typeof value !== 'object') return value;
  const { auth_clock: _clock, ...copy } = value;
  return transferServerClock(value, copy);
}

export function setActiveTokenClock(token, observation) { activeToken = token && observation ? { token, observation } : null; }
export const activeTokenClock = token => activeToken?.token === token ? activeToken.observation : null;
