import { useEffect, useReducer, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { userHasCapability } from '@/shared/lib/access';
import { adminAccessApi } from './api';

export const ACCESS_CAPABILITY = 'admin.authority.manage';
export const adminAccessKeys = { all: (scope) => ['admin-access', scope] };
export function useAccessGrants({ cursor, kind, enabled }) {
  const scope = getV2ClientScopeKey();
  return useQuery({
    queryKey: [...adminAccessKeys.all(scope), kind || 'all', cursor || 'first'],
    queryFn: ({ signal }) => adminAccessApi.list({ limit: 25, ...(cursor ? { cursor } : {}), ...(kind ? { kind } : {}) }, { signal }),
    enabled, retry: false, staleTime: 0, refetchOnMount: 'always',
  });
}
const initial = { busy: false, error: null, saved: null, unconfirmed: false, refreshFailed: false };
function reducer(state, patch) { return { ...state, ...patch }; }
function sameScope(current, authenticated) {
  return Boolean(current?.id && current.email && current.facilityCode && current.accessContext?.facility_id && current.accessContext?.active_profile && authenticated?.id === current.id
    && authenticated.facilityCode === current.facilityCode
    && authenticated.accessContext?.facility_id === current.accessContext?.facility_id
    && authenticated.accessContext?.active_profile === current.accessContext?.active_profile
    && userHasCapability(authenticated, ACCESS_CAPABILITY));
}
export function useRevokeAccessGrant({ grant, user, reauthenticate }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const operation = useRef(null);
  const lastDecision = useRef(undefined);
  const queryClient = useQueryClient();
  useEffect(() => () => operation.current?.abort(), []);
  const submit = async ({ password, reconciliation }) => {
    if (operation.current || state.saved || !password || !userHasCapability(user, ACCESS_CAPABILITY)) return false;
    const controller = new AbortController();
    operation.current = controller;
    dispatch({ busy: true, error: null });
    let mutationStarted = false;
    try {
      const authenticated = await reauthenticate(user.email, password, user.facilityCode, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      if (!sameScope(user, authenticated)) throw new Error('The signed-in account or access scope changed. Reload before changing access.');
      const decision = state.unconfirmed ? lastDecision.current : reconciliation;
      lastDecision.current = decision;
      mutationStarted = true;
      const saved = await adminAccessApi.revoke(grant.kind, grant.id, decision, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      dispatch({ saved, unconfirmed: false });
      try {
        await queryClient.invalidateQueries({ queryKey: adminAccessKeys.all(getV2ClientScopeKey()) }, { throwOnError: true });
      } catch {
        if (!controller.signal.aborted) dispatch({ refreshFailed: true });
      }
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      const unconfirmed = state.unconfirmed || (mutationStarted && (!error.status || error.status >= 500
        || error.data?.error?.code === 'access_grant_revoke_failed' || error.code === 'access_grant_revoke_failed'));
      dispatch({ unconfirmed, error: unconfirmed
        ? 'The grant may already be revoked. Refresh the grant list to check, or retry this same revocation. No second grant will be created.'
        : error.message || 'Access could not be changed.' });
      return false;
    } finally {
      if (!controller.signal.aborted) dispatch({ busy: false });
      operation.current = null;
    }
  };
  return { ...state, submit };
}
