import { useLayoutEffect, useMemo, useRef } from 'react';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { networkEditorIdentity } from './model';
import { useV2TransportScope } from './hooks';

export function useNetworkRequestGuard(user, snapshot) {
  const transportScope = useV2TransportScope(); const authorityScope = networkEditorIdentity(user); const binding = useRef(null);
  const principal = useMemo(() => ({ id: user?.id, facility_code: user?.facilityCode, facility_id: user?.accessContext?.facility_id,
    active_profile: user?.accessContext?.active_profile, session_version: user?.accessContext?.session_version, permission_version: user?.accessContext?.permission_version }),
  [user?.id, user?.facilityCode, user?.accessContext?.facility_id, user?.accessContext?.active_profile, user?.accessContext?.session_version, user?.accessContext?.permission_version]);
  useLayoutEffect(() => {
    activateWriteUncertainty(principal, { authority: authorityScope, transport: transportScope });
    const current = bindNetworkAccessGuard({ transportScope, authorityScope, principal }); binding.current = current;
    return () => { current.release(); activateWriteUncertainty(null); binding.current = null; };
  }, [transportScope, authorityScope, principal]);
  useLayoutEffect(() => { binding.current?.update(snapshot); }, [snapshot, transportScope, authorityScope, principal]);
}
