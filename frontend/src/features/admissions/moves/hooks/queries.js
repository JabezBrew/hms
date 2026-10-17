import { useQuery } from '@tanstack/react-query';
import { admissionMoveApi } from '../api';
import { moveKeys } from '../keys';
const live = { retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true };
export function usePlacement(scope, proof, enabled) {
  return useQuery({ ...live, queryKey: moveKeys.context(proof, scope.patientId, scope.caseId, enabled ? 'open' : 'closed'), queryFn: ({ signal }) => admissionMoveApi.context(scope, { signal }), enabled, refetchInterval: enabled ? 15000 : false });
}
export function useMoveDestinations(scope, proof, token, query, enabled) {
  return useQuery({ ...live, queryKey: moveKeys.destinations(proof, scope.patientId, scope.caseId, token, query), queryFn: ({ signal }) => admissionMoveApi.destinations(scope, query, { signal }), enabled });
}
export function useMoveHistory(scope, proof, query, enabled) {
  return useQuery({ ...live, queryKey: moveKeys.history(proof, scope.patientId, scope.caseId, query), queryFn: ({ signal }) => admissionMoveApi.history(scope, query, { signal }), enabled });
}
export function useMoveDetail(scope, proof, id, enabled) {
  return useQuery({ ...live, queryKey: moveKeys.detail(proof, scope.patientId, scope.caseId, id), queryFn: ({ signal }) => admissionMoveApi.detail(scope, id, { signal }), enabled: enabled && Boolean(id) });
}
