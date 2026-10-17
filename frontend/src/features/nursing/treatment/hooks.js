import { useQuery } from '@tanstack/react-query';
import { treatmentApi } from './api';
import { treatmentKeys } from './keys';

const current = { retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true };
// Changing the observer's query on close resets isFetchedAfterMount on reopen.
// Cached context cannot expose a retained draft before that new protected read.
export function useTreatmentContext(scope, proof, enabled) { return useQuery({ ...current, queryKey: treatmentKeys.context(proof, scope.patientId, scope.caseId, enabled ? 'open' : 'closed'), queryFn: ({ signal }) => treatmentApi.context(scope, { signal }), enabled, refetchInterval: enabled ? 15000 : false }); }
export function useTreatmentCourses(scope, proof, query, enabled) { return useQuery({ ...current, queryKey: treatmentKeys.list(proof, scope.patientId, scope.caseId, query), queryFn: ({ signal }) => treatmentApi.list(scope, query, { signal }), enabled }); }
export function useTreatmentDetail(scope, proof, enabled) { return useQuery({ ...current, queryKey: treatmentKeys.detail(proof, scope.patientId, scope.caseId, scope.courseId), queryFn: ({ signal }) => treatmentApi.detail(scope, { signal }), enabled: enabled && Boolean(scope.courseId) }); }
export function useTreatmentEvidence(kind, scope, proof, query, enabled) { return useQuery({ ...current, queryKey: treatmentKeys[kind](proof, scope.patientId, scope.caseId, scope.courseId, query), queryFn: ({ signal }) => treatmentApi[kind](scope, query, { signal }), enabled: enabled && Boolean(scope.courseId) }); }
