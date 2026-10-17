import { useQuery } from '@tanstack/react-query';
import { referralResponseApi } from '../api';
import { responseKeys } from '../keys';
const current = { retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true };
export function useResponseContext(scope, proof, enabled) {
  return useQuery({ ...current, queryKey: responseKeys.context(proof, scope.patientId, scope.referralId, enabled ? 'open' : 'closed'), queryFn: ({ signal }) => referralResponseApi.context(scope, { signal }), enabled, refetchInterval: enabled ? 15000 : false });
}
export function useResponseHistory(scope, proof, query, enabled) {
  return useQuery({ ...current, queryKey: responseKeys.history(proof, scope.patientId, scope.referralId, query), queryFn: ({ signal }) => referralResponseApi.history(scope, query, { signal }), enabled });
}
export function useResponseVersion(scope, proof, versionId, enabled) {
  return useQuery({ ...current, queryKey: responseKeys.version(proof, scope.patientId, scope.referralId, versionId), queryFn: ({ signal }) => referralResponseApi.version(scope, versionId, { signal }), enabled: enabled && Boolean(versionId) });
}
