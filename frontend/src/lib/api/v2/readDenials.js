// Only the actual transport attaches this RAM-only denial witness. It can hide
// stale local content; it grants no read, write, receipt or acknowledgment right.
// WeakMap identity deliberately survives neither copying nor serialization.
const denials = new WeakMap();
export function attachReadDenial(error, isCurrent) {
  if (error && typeof error === 'object' && typeof isCurrent === 'function') denials.set(error, isCurrent);
  return error;
}
export function isCurrentReadDenial(error) {
  try { return denials.get(error)?.() === true; } catch { return false; }
}
