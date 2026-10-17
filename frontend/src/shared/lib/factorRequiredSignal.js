// Volatile coarse signal only. The caller supplies an opaque scope hash.
let snapshot = null;
const listeners = new Set();
export const getFactorRequirement = () => snapshot;
export const subscribeFactorRequirement = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export function publishFactorRequirement(scopeKey) {
  if (typeof scopeKey !== 'string' || !/^[a-z0-9_-]+$/i.test(scopeKey)) return;
  snapshot = scopeKey; listeners.forEach((listener) => listener());
}
export function dismissFactorRequirement() { snapshot = null; listeners.forEach((listener) => listener()); }
