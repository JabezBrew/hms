import { getV2ClientScopeKey } from '@/lib/api/v2/client';

// Authentication seeds only this exact query after a verified proof upgrade.
// Keep the key factory independent of the optional network workflow hooks/UI.
export const networkKeys = {
  root: ['network-access'],
  scope: (proof = getV2ClientScopeKey()) => ['network-access', proof],
  current: (proof) => [...networkKeys.scope(proof), 'current'],
  policy: (proof) => [...networkKeys.scope(proof), 'policy'],
};
