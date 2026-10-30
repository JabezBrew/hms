import { useLayoutEffect, useMemo, useRef } from 'react';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { networkEditorIdentity } from './model';
import { useV2TransportScope } from './hooks';

// This private RAM projection is an immutable value, separate from query hashes
// and the flat refresh principal. Observation clocks never confer owner identity.
function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  return value;
}
function readOwnerValue(user) {
  const context = user?.accessContext, security = context?.auth_security;
  const { auth_clock: _clock, ...ownerSecurity } = security || {};
  return JSON.stringify([user?.id, user?.facilityCode, context?.facility_id, context?.active_profile, context?.session_version, context?.permission_version,
    [...(user?.adminAccess?.capabilities || [])].sort(), [...(context?.features || [])].sort(), [...(context?.patient_visibility || [])].sort(),
    security ? canonicalValue(ownerSecurity) : null]);
}
export function useNetworkRequestGuard(user, snapshot) {
  const ownerValue = readOwnerValue(user);
  const transportScope = useV2TransportScope(); const authorityScope = networkEditorIdentity(user); const binding = useRef(null);
  const principal = useMemo(() => ({ id: user?.id, facility_code: user?.facilityCode, facility_id: user?.accessContext?.facility_id,
    active_profile: user?.accessContext?.active_profile, session_version: user?.accessContext?.session_version, permission_version: user?.accessContext?.permission_version }),
  [user?.id, user?.facilityCode, user?.accessContext?.facility_id, user?.accessContext?.active_profile, user?.accessContext?.session_version, user?.accessContext?.permission_version]);
  useLayoutEffect(() => {
    activateWriteUncertainty(principal, { authority: authorityScope, transport: transportScope });
    const current = bindNetworkAccessGuard({ transportScope, authorityScope, principal }); binding.current = current;
    return () => { current.release(); activateWriteUncertainty(null); binding.current = null; };
  }, [transportScope, authorityScope, principal]);
  useLayoutEffect(() => { binding.current?.observeReadOwner(ownerValue); }, [ownerValue, transportScope, authorityScope, principal]);
  useLayoutEffect(() => { binding.current?.update(snapshot); }, [snapshot, transportScope, authorityScope, principal]);
}
