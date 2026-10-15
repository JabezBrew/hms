import { v2Api } from '@/lib/api/v2/client';

export const adminAccessApi = {
  async list(query, { signal } = {}) {
    const envelope = await v2Api.getAdminAccessGrants({ query, signal });
    if (!Array.isArray(envelope?.data) || !envelope?.page) throw new Error('Access grants were not returned. Refresh before making changes.');
    return envelope;
  },
  async revoke(kind, id, reconciliation, { signal } = {}) {
    const envelope = await v2Api.postAdminAccessGrantRevoke({ kind, id }, reconciliation ? { reconciliation } : {}, { signal });
    const saved = envelope?.data;
    if (saved?.id !== id || saved.kind !== kind || saved.status !== 'revoked' || !Number.isFinite(Date.parse(saved.revoked_at))) {
      throw new Error('The server did not confirm the revoked grant.');
    }
    return saved;
  },
};
