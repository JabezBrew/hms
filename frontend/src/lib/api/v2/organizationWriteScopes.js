import { currentNetworkAuthorityScope } from './networkAccessGuard';
import { getV2ClientScopeKey } from './client';
import { commandReceipt, validId } from '@/features/admin/organization/model';
// Ordinary directory/current-state reads never establish the result of a command.
// Only the actual actor-bound original command receipt can review this family.
export function classifyOrganizationWriteScope(path) {
  const match = /^\/api\/v2\/admin\/org-units\/commands\/([^/]+)$/.exec(path);
  if (!match || !validId(match[1])) return { excludeRead: true };
  return { receiptRequestId: match[1], receiptMatches: async (envelope, principal) => {
    try { await commandReceipt(envelope?.data, { requestId: match[1], actorId: principal?.id }); return true; }
    catch { return false; }
  } };
}

export async function organizationRecoveryCandidate(store, origin) {
  const current = () => { const now = store.current(); return origin.scope && origin.context?.authority && origin.context?.transport && now.scope === origin.scope && now.activation === origin.activation && now.context?.authority === origin.context.authority && now.context?.transport === origin.context.transport && origin.context.authority === currentNetworkAuthorityScope() && origin.context.transport === getV2ClientScopeKey(); };
  if (!current()) return null;
  const family = await store.digest('family:api/v2/admin/org-units');
  if (!current()) return null;
  const entries = store.load().entries.filter(entry => entry.scope === origin.scope);
  if (entries.some(entry => store.active(entry.id))) return null;
  const candidates = entries.filter(entry => entry.family === family);
  if (candidates.length !== 1 || !validId(candidates[0].uuid)) return null;
  return candidates[0].uuid;
}
