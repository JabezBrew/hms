import { currentNetworkAuthorityScope } from './networkAccessGuard';
import { getV2ClientScopeKey } from './client';
import { commandReceipt, validId } from '@/features/laboratory/administration/model';
import { commandWire } from '@/features/laboratory/administration/commandWire';
import { prepareWriteIntent } from './writeReplayPolicy';
const family = 'api/v2/laboratory/catalog';
export function classifyLaboratoryCatalogWriteScope(path) {
  const write = /^\/api\/v2\/laboratory\/(?:test-catalog|panels)\/([^/]+)\/availability$/.exec(path);
  if (write && validId(write[1])) return { family, retryTemplate: `POST ${path.replace(write[1], ':id')}`, excludeRead: true };
  const match = /^\/api\/v2\/laboratory\/catalog-commands\/([^/]+)$/.exec(path);
  // Clinical catalogs, current definitions and general history cannot establish
  // any original result or clear the cross-kind unknown-write barrier.
  if (!match || !validId(match[1])) return { excludeRead: true };
  let receipt;
  return { family, receiptRequestId: match[1],
    receiptMatches: async (envelope, principal) => {
      try { receipt = await commandReceipt(envelope?.data, { requestId: match[1], actorId: principal?.id }); return true; }
      catch { return false; }
    },
    receiptFingerprint: async (_envelope, digest) => {
      if (!receipt) throw new Error('The original availability receipt could not be confirmed.');
      const wire = await commandWire(receipt.reviewed_input);
      const intent = prepareWriteIntent({ path: wire.path, resolvedPath: wire.path, query: {}, body: wire.body }, wire.method);
      if (!intent.replayable) throw new Error('The original availability request could not be confirmed.');
      return digest(intent.input);
    },
  };
}
export async function laboratoryCatalogRecoveryCandidate(store, origin) {
  const current = () => { const now = store.current(); return origin.scope && origin.context?.authority && origin.context?.transport && now.scope === origin.scope && now.activation === origin.activation && now.context?.authority === origin.context.authority && now.context?.transport === origin.context.transport && origin.context.authority === currentNetworkAuthorityScope() && origin.context.transport === getV2ClientScopeKey(); };
  if (!current()) return null;
  const familyHash = await store.digest(`family:${family}`);
  if (!current()) return null;
  const entries = store.load().entries.filter(entry => entry.scope === origin.scope);
  if (entries.some(entry => store.active(entry.id))) return null;
  const candidates = entries.filter(entry => entry.family === familyHash);
  return candidates.length === 1 && validId(candidates[0].uuid) ? candidates[0].uuid : null;
}
