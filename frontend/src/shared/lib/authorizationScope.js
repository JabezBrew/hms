import { hashQueryValue } from './privateQueryKey';

// A normal credential confirmation rotates the token. Keep that operation
// mounted while resetting copied drafts when the actor or authority changes.
export function authorizationIdentity(user) {
  return JSON.stringify([user?.id, user?.facilityCode, user?.accessContext?.facility_id, user?.accessContext?.active_profile,
    user?.accessContext?.session_version, user?.accessContext?.permission_version,
    hashQueryValue(JSON.stringify([[...(user?.adminAccess?.capabilities || [])].sort(), [...(user?.accessContext?.features || [])].sort(),
      [...(user?.accessContext?.patient_visibility || [])].sort(), user?.accessContext?.auth_security]))]);
}
export const authorizationScope = (user, clientScope) => hashQueryValue(JSON.stringify([clientScope, authorizationIdentity(user)]));
