import { currentNetworkAuthorityScope } from './networkAccessGuard';
import { getV2ClientScopeKey } from './client';
import { commandReceipt, validId } from '@/features/inventory/suppliers/model';
import { commandWire } from '@/features/inventory/suppliers/commandWire';
import { prepareWriteIntent } from './writeReplayPolicy';
// Current supplier, directory, history and legacy unkeyed reads establish no
// original command outcome. Only the exact actor-bound receipt can review.
export function classifyInventorySupplierWriteScope(path) {
  const match = /^\/api\/v2\/inventory\/supplier-commands\/([^/]+)$/.exec(path);
  if (!match || !validId(match[1])) return { excludeRead: true };
  let receipt;
  return {
    family: 'api/v2/inventory/suppliers', receiptRequestId: match[1],
    receiptMatches: async (envelope, principal) => {
      try { receipt = await commandReceipt(envelope?.data, { requestId: match[1], actorId: principal?.id }); return true; }
      catch { return false; }
    },
    receiptFingerprint: async (_envelope, digest) => {
      if (!receipt) throw new Error('The original supplier receipt could not be confirmed.');
      const wire = commandWire(receipt.reviewed_input);
      const intent = prepareWriteIntent({ path: wire.path, resolvedPath: wire.path, query: {}, body: wire.body }, 'POST');
      if (!intent.replayable) throw new Error('The original supplier request could not be confirmed.');
      return digest(intent.input);
    },
  };
}
export async function inventorySupplierRecoveryCandidate(store, origin) {
  const current = () => { const now = store.current(); return origin.scope && origin.context?.authority && origin.context?.transport && now.scope === origin.scope && now.activation === origin.activation && now.context?.authority === origin.context.authority && now.context?.transport === origin.context.transport && origin.context.authority === currentNetworkAuthorityScope() && origin.context.transport === getV2ClientScopeKey(); };
  if (!current()) return null;
  const family = await store.digest('family:api/v2/inventory/suppliers');
  if (!current()) return null;
  const entries = store.load().entries.filter(entry => entry.scope === origin.scope);
  if (entries.some(entry => store.active(entry.id))) return null;
  const candidates = entries.filter(entry => entry.family === family);
  if (candidates.length !== 1 || !validId(candidates[0].uuid)) return null;
  return candidates[0].uuid;
}
