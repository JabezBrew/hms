import { useQuery } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { useAuth } from '@/lib/auth';
import { networkApi } from './api';
import { networkAccessScope } from './model';
import { useNetworkDecisionExpired } from './useNetworkDecisionExpired';

export const networkKeys = {
  root: ['network-access'],
  scope: (proof = getV2ClientScopeKey()) => ['network-access', proof],
  current: (proof) => [...networkKeys.scope(proof), 'current'],
  policy: (proof) => [...networkKeys.scope(proof), 'policy'],
};
export function useV2TransportScope() { return useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey); }
export function useNetworkScope() { const { user } = useAuth(); return networkAccessScope(user, useV2TransportScope()); }
export function useNetworkAccessDecision(enabled = true) {
  const proof = useNetworkScope();
  const query = useQuery({ queryKey: networkKeys.current(proof), queryFn: ({ signal }) => networkApi.current({ signal }), enabled,
    retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: () => document.hidden ? false : 15000 });
  const expired = useNetworkDecisionExpired(query.data);
  const refetch = query.refetch;
  useEffect(() => { if (enabled && expired) void refetch(); }, [enabled, expired, refetch]);
  return { ...query, expired };
}
export function useNetworkPolicy(enabled) {
  const proof = useNetworkScope();
  return useQuery({ queryKey: networkKeys.policy(proof), queryFn: ({ signal }) => networkApi.policy({ signal }), enabled,
    retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
}
