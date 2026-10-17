import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { clearWorkflowContinuity, getWorkflowContinuity, stagedNetworkDecision, subscribeWorkflowContinuity } from '@/shared/lib/workflowContinuity';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { useAuth } from '@/lib/auth';
import { networkApi } from './api';
import { networkAccessScope } from './model';
import { useNetworkDecisionExpired } from './useNetworkDecisionExpired';
import { networkKeys } from './keys';

export { networkKeys } from './keys';
export function useV2TransportScope() { return useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey); }
export function useNetworkScope() { const { user } = useAuth(); return networkAccessScope(user, useV2TransportScope()); }
export function useNetworkAccessDecision(enabled = true) {
  const proof = useNetworkScope();
  const continuity = useSyncExternalStore(subscribeWorkflowContinuity, getWorkflowContinuity, () => null);
  const [, tick] = useState(0);
  useEffect(() => { if (!continuity) return; const timer = window.setTimeout(() => tick((value) => value + 1), Math.max(0, continuity.stagedUntil - Date.now())); return () => window.clearTimeout(timer); }, [continuity]);
  const query = useQuery({ queryKey: networkKeys.current(proof), queryFn: ({ signal }) => networkApi.current({ signal }), enabled,
    retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: () => document.hidden ? false : 15000 });
  const expired = useNetworkDecisionExpired(query.data);
  const staged = stagedNetworkDecision(proof);
  const stagedConfirmed = Boolean(staged && !expired && !query.isError && ['policy_version', 'classification', 'provenance', 'mode', 'access_allowed', 'read_only', 'reauth_required'].every((key) => query.data?.[key] === staged[key]));
  useEffect(() => { if (staged && (query.isError || expired || (query.isFetchedAfterMount && !stagedConfirmed))) clearWorkflowContinuity(); }, [staged, query.isError, query.isFetchedAfterMount, expired, stagedConfirmed]);
  const refetch = query.refetch;
  useEffect(() => { if (enabled && expired) void refetch(); }, [enabled, expired, refetch]);
  return { ...query, expired, stagedConfirmed };
}
export function useNetworkPolicy(enabled) {
  const proof = useNetworkScope();
  return useQuery({ queryKey: networkKeys.policy(proof), queryFn: ({ signal }) => networkApi.policy({ signal }), enabled,
    retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
}
