import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { problemsApi } from '../api';

export const problemKeys = {
  all: ['problems'],
  patient: (patientId, filters = {}) => ['problems', 'patient', patientId, filters],
  detail: (id) => ['problems', 'detail', id],
  codes: (q, filters = {}) => ['problems', 'codes', q, filters],
  links: (filters = {}) => ['problems', 'links', filters],
};

export function usePatientProblems(patientId, { includeResolved = false } = {}) {
  return useQuery({
    queryKey: problemKeys.patient(patientId, { includeResolved }),
    queryFn: ({ signal }) =>
      problemsApi.listForPatient(patientId, {
        ...(includeResolved ? { include_resolved: '1' } : {}),
      }, { signal }),
    enabled: !!patientId,
    staleTime: 30_000,
  });
}

export function useProblem(id) {
  return useQuery({
    queryKey: problemKeys.detail(id),
    queryFn: ({ signal }) => problemsApi.detail(id, { signal }),
    enabled: !!id,
  });
}

export function useSearchProblemCodes(q, { quickPicksOnly = false, codeSystem } = {}) {
  return useQuery({
    queryKey: problemKeys.codes(q, { quickPicksOnly, codeSystem }),
    queryFn: ({ signal }) =>
      problemsApi.searchCodes(q, {
        ...(quickPicksOnly ? { quick_picks_only: '1' } : {}),
        ...(codeSystem ? { code_system: codeSystem } : {}),
      }, { signal }),
    staleTime: 60_000,
  });
}

export function useCreateProblem(patientId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => problemsApi.create({ patient: patientId, ...payload }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['problems', 'patient', patientId] }),
  });
}

export function useChangeProblemStatus(patientId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) => problemsApi.changeStatus(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['problems', 'patient', patientId] });
    },
  });
}

export function useUpdateProblem(patientId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }) => problemsApi.update(id, payload),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['problems', 'patient', patientId] });
      qc.invalidateQueries({ queryKey: problemKeys.detail(vars.id) });
    },
  });
}

export function useProblemLinks(filters) {
  return useQuery({
    queryKey: problemKeys.links(filters || {}),
    queryFn: ({ signal }) => problemsApi.listLinks(filters, { signal }),
    enabled: !!filters && Object.keys(filters).length > 0,
    staleTime: 30_000,
  });
}

export function useCreateProblemLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => problemsApi.createLink(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['problems', 'links'] }),
  });
}

export function useDeleteProblemLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => problemsApi.deleteLink(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['problems', 'links'] }),
  });
}
