import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { equalNetworks, NETWORK_MODES, NETWORK_REASONS } from './model';

const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const version = (value) => Number.isSafeInteger(value) && value >= 0;
const mode = (value) => NETWORK_MODES.some((item) => item.value === value);
export function confirmedNetworkDecision(value, { candidate = false } = {}) {
  if (!['onsite', 'offsite', 'unknown'].includes(value?.classification) || !['direct', 'trusted_proxy', 'unknown'].includes(value.provenance)
    || !(value.policy_version === null || version(value.policy_version)) || !(value.mode === null || mode(value.mode))
    || !['access_allowed', 'read_only', 'reauth_required'].every((key) => typeof value[key] === 'boolean')
    || !(value.reauth_expires_at === null || date(value.reauth_expires_at)) || !date(value.evaluated_at) || !NETWORK_REASONS.has(value.reason)
    || ((value.classification === 'unknown' || (!candidate && value.policy_version === null)) && !value.read_only)
    || (value.classification === 'offsite' && value.mode === 'fresh_reauth' && value.access_allowed && !value.read_only && !date(value.reauth_expires_at))) {
    throw new Error('The current network access decision could not be confirmed.');
  }
  // Ordinary status never exposes an address or the facility network list.
  return Object.fromEntries(['classification', 'provenance', 'policy_version', 'mode', 'access_allowed', 'read_only', 'reauth_required', 'reauth_expires_at', 'evaluated_at', 'reason'].map((key) => [key, value[key]]));
}
export function confirmedNetworkPolicy(value) {
  if (typeof value?.configured !== 'boolean' || !version(value.version) || !Array.isArray(value.onsite_cidrs)
    || value.onsite_cidrs.length > 64 || value.onsite_cidrs.some((cidr) => typeof cidr !== 'string' || !cidr || cidr.length > 43)
    || !(mode(value.offsite_mode) || (!value.configured && value.offsite_mode === null))
    || !(value.updated_at === null || date(value.updated_at)) || !(value.updated_by_user_id === null || typeof value.updated_by_user_id === 'string')
    || (value.configured && (value.version < 1 || value.onsite_cidrs.length === 0))) throw new Error('The facility network policy could not be confirmed.');
  return Object.fromEntries(['configured', 'version', 'onsite_cidrs', 'offsite_mode', 'updated_at', 'updated_by_user_id'].map((key) => [key, value[key]]));
}
export class NetworkPolicyUnconfirmedError extends Error {
  constructor() { super('This policy may already be saved. Keep this request unchanged. Review the current policy or retry the exact same change after confirming your password.'); this.name = 'NetworkPolicyUnconfirmedError'; }
}
const uncertain = (error) => !error?.status || error.status >= 500 || (error?.data?.error?.code || error?.code || '').endsWith('_unconfirmed');
export const networkApi = {
  async current({ signal } = {}) { return confirmedNetworkDecision((await v2Api.getAuthNetworkAccess({ signal }))?.data); },
  async policy({ signal } = {}) {
    const value = (await v2Api.getAdminNetworkPolicy({ signal }))?.data;
    if (typeof value?.can_update !== 'boolean') throw new Error('Network policy administration could not be confirmed.');
    return { policy: confirmedNetworkPolicy(value.policy), current_access: confirmedNetworkDecision(value.current_access), can_update: value.can_update };
  },
  async preview(payload, { signal } = {}) {
    const value = (await v2Api.postAdminNetworkPolicyPreview(payload, { signal }))?.data;
    if (typeof value?.current_connection_retained_onsite !== 'boolean' || !Array.isArray(value.candidate?.onsite_cidrs)
      || value.candidate.onsite_cidrs.length < 1 || value.candidate.onsite_cidrs.length > 64 || value.candidate.onsite_cidrs.some((cidr) => typeof cidr !== 'string' || !cidr)
      || value.candidate.offsite_mode !== payload.offsite_mode) throw new Error('The candidate network policy could not be confirmed.');
    return { current_connection_retained_onsite: value.current_connection_retained_onsite, candidate: value.candidate, candidate_access: confirmedNetworkDecision(value.candidate_access, { candidate: true }) };
  },
  async save(payload, { signal } = {}) {
    let response;
    try {
      response = await v2Api.putAdminNetworkPolicy(payload, { signal }); const value = response?.data;
      const policy = confirmedNetworkPolicy(value?.policy);
      if (value.client_request_id !== payload.client_request_id || typeof value.replayed !== 'boolean' || policy.version !== payload.expected_version + 1 || !date(policy.updated_at)
        || !policy.configured || policy.offsite_mode !== payload.offsite_mode || !equalNetworks(policy.onsite_cidrs, payload.onsite_cidrs)) throw new NetworkPolicyUnconfirmedError();
      acknowledgeWriteResponse(response); return { client_request_id: value.client_request_id, policy, replayed: value.replayed };
    } catch (error) { if (uncertain(error)) { markWriteResponseUncertain(response || error); throw new NetworkPolicyUnconfirmedError(); } throw error; }
  },
};
