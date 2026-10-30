import { hashQueryValue } from './privateQueryKey';
import { workflowIdentityKey, workflowScope } from './workflowContinuity';

// A normal credential confirmation rotates the token. Keep that operation
// mounted while resetting copied drafts when the actor or authority changes.
export function authorizationIdentity(user) {
  const original = user?.accessContext?.auth_security;
  const { auth_clock: _clock, ...security } = original || {};
  return JSON.stringify([user?.id, user?.facilityCode, user?.accessContext?.facility_id, user?.accessContext?.active_profile,
    user?.accessContext?.session_version, user?.accessContext?.permission_version,
    hashQueryValue(JSON.stringify([[...(user?.adminAccess?.capabilities || [])].sort(), [...(user?.accessContext?.features || [])].sort(),
      [...(user?.accessContext?.patient_visibility || [])].sort(), (original ? security : original)]))]);
}
export const requestAuthorizationScope = (user, clientScope) => hashQueryValue(JSON.stringify([clientScope, authorizationIdentity(user)]));
export const authorizationScope = (user, clientScope) => workflowScope(requestAuthorizationScope(user, clientScope));
export const workflowAuthorizationIdentity = (user, clientScope) => workflowIdentityKey(requestAuthorizationScope(user, clientScope), hashQueryValue(authorizationIdentity(user)));
