import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { userHasCapability } from '@/shared/lib/access';

export const NETWORK_ADMIN_CAPABILITY = 'admin.authority.manage';
export const NETWORK_MODES = [
  { value: 'readonly', label: 'Read-only access', description: 'Allow clinical reads offsite; prevent workflow changes.' },
  { value: 'deny', label: 'Deny workflow access', description: 'Require an approved network for clinical workflows.' },
  { value: 'fresh_reauth', label: 'Require a fresh sign-in', description: 'Allow offsite workflow access while the existing credential reauthentication is current. This is not a claim of fresh multi-factor verification.' },
];
export const NETWORK_REASONS = new Set(['onsite', 'offsite_readonly', 'offsite_denied', 'offsite_fresh_reauth', 'reauth_required', 'policy_unconfigured', 'client_unknown']);

// A normal credential confirmation rotates the token. Keep that operation
// mounted while resetting copied drafts when the actor or authority changes.
export function networkEditorIdentity(user) {
  return JSON.stringify([user?.id, user?.facilityCode, user?.accessContext?.facility_id, user?.accessContext?.active_profile,
    user?.accessContext?.session_version, user?.accessContext?.permission_version,
    hashQueryValue(JSON.stringify([[...(user?.adminAccess?.capabilities || [])].sort(), [...(user?.accessContext?.features || [])].sort(),
      [...(user?.accessContext?.patient_visibility || [])].sort(), user?.accessContext?.auth_security]))]);
}
export const networkAccessScope = (user, clientScope) => hashQueryValue(JSON.stringify([clientScope, networkEditorIdentity(user)]));
export function assertNetworkSession(current, authenticated) {
  if (!current?.id || !current.email || !current.facilityCode || !current.accessContext?.facility_id || !current.accessContext?.active_profile
    || authenticated?.mfaRequired || authenticated?.id !== current.id || authenticated.facilityCode !== current.facilityCode
    || authenticated.accessContext?.facility_id !== current.accessContext.facility_id
    || authenticated.accessContext?.active_profile !== current.accessContext.active_profile) {
    throw new Error('The signed-in account or access scope changed. Reload before changing network access.');
  }
}
export function assertNetworkAuthority(current, authenticated) {
  assertNetworkSession(current, authenticated);
  if (!userHasCapability(authenticated, NETWORK_ADMIN_CAPABILITY)) throw new Error('Network administration access is no longer available. Reload your access before continuing.');
}
export function networkCandidate(text, mode) {
  const cidrs = text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (cidrs.length < 1 || cidrs.length > 64) throw new Error('Enter between 1 and 64 approved CIDR networks, one per line.');
  if (cidrs.some((cidr) => cidr.length > 43 || !cidr.includes('/') || /\/0$/.test(cidr))) throw new Error('Use CIDR notation with a network prefix. A network covering every address is not allowed.');
  if (new Set(cidrs.map((cidr) => cidr.toLowerCase())).size !== cidrs.length) throw new Error('Remove duplicate network entries before review.');
  if (!NETWORK_MODES.some((item) => item.value === mode)) throw new Error('Choose how offsite access is handled.');
  return { onsite_cidrs: cidrs, offsite_mode: mode };
}
export function networkReason(reason) {
  const value = reason.trim();
  if (!value || [...value].length > 1000) throw new Error('Record a reason of up to 1000 characters for this policy version.');
  return value;
}
export function equalNetworks(left, right) {
  const sortedRight = [...right].sort();
  return left.length === right.length && [...left].sort().every((value, index) => value === sortedRight[index]);
}
