import { useLayoutEffect, useReducer, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { nursingKeys } from '@/hooks/nursing/nursingQueryKeys';
import { useAuth } from '@/lib/auth';
import { fluidAccessScope } from './model';
import { fluidApi } from './api';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
export const fluidKeys = {
  root: ['fluid-observations'],
  scope: (proof = getV2ClientScopeKey()) => ['fluid-observations', proof],
  patient: (id, proof) => [...fluidKeys.scope(proof), 'patient', id],
  list: (query, proof) => [...fluidKeys.patient(query.patient_id, proof), 'list', query],
  summary: (query, proof) => [...fluidKeys.patient(query.patient_id, proof), 'summary', query],
  source: (id, proof) => [...fluidKeys.scope(proof), 'source', id],
  history: (id, proof) => [...fluidKeys.scope(proof), 'history', id],
  assessment: (query, proof) => [...fluidKeys.scope(proof), 'assessment', query],
  context: (query, proof) => [...fluidKeys.scope(proof), 'context', query],
  rules: (proof) => [...fluidKeys.scope(proof), 'rules'],
};
function useFluidScope() { const { user } = useAuth(); return fluidAccessScope(user, getV2ClientScopeKey()); }
function nextPage(page, pages) { return !page.next || pages.length >= 100 || pages.slice(0, -1).some((p) => p.next === page.next) ? undefined : page.next; }
function withPaginationStatus(query) { const pages = query.data?.pages || []; const last = pages.at(-1); const incomplete = Boolean(last?.next && !nextPage(last, pages)); return { ...query, isError: query.isError || incomplete, error: incomplete ? new Error('Pagination could not be completed. Refresh or narrow the observation date.') : query.error }; }
export function useFluidObservations(query, enabled) { const proof = useFluidScope(); return withPaginationStatus(useInfiniteQuery({ queryKey: fluidKeys.list(query, proof), queryFn: ({ pageParam, signal }) => fluidApi.list({ ...query, limit: 25, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }), initialPageParam: undefined, getNextPageParam: nextPage, enabled, retry: false, staleTime: 0 })); }
export function useFluidSummary(query, enabled) { const proof = useFluidScope(); return useQuery({ queryKey: fluidKeys.summary(query, proof), queryFn: ({ signal }) => fluidApi.summary(query, { signal }), enabled, retry: false, staleTime: 0 }); }
export function useFluidSource(source, enabled) { const proof = useFluidScope(); const id = typeof source === 'string' ? source : source?.id; return useQuery({ queryKey: fluidKeys.source(id, proof), queryFn: ({ signal }) => fluidApi.get(id, { signal, expected: typeof source === 'object' ? source : undefined }), enabled: Boolean(id) && enabled, retry: false, staleTime: 0, refetchOnMount: 'always' }); }
export function useFluidHistory(source, enabled = true) { const proof = useFluidScope(); const id = typeof source === 'string' ? source : source?.id; return withPaginationStatus(useInfiniteQuery({ queryKey: fluidKeys.history(id, proof), queryFn: ({ pageParam, signal }) => fluidApi.history(id, pageParam, { signal, expected: typeof source === 'object' ? source : undefined }), initialPageParam: undefined, getNextPageParam: nextPage, enabled: Boolean(id) && enabled, retry: false, refetchOnMount: 'always' })); }
export function useFluidContext(query, enabled) { const proof = useFluidScope(); return useQuery({ queryKey: fluidKeys.context(query, proof), queryFn: ({ signal }) => fluidApi.context(query, { signal }), enabled: enabled && Boolean(query.admission_case_id), retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: enabled ? 15000 : false }); }
export function useFluidAssessment(query, enabled) { const proof = useFluidScope(); return useQuery({ queryKey: fluidKeys.assessment(query, proof), queryFn: ({ signal }) => fluidApi.assessment(query, { signal }), enabled: enabled && Boolean(query.admission_case_id), retry: false, staleTime: 0 }); }
export function useFluidRules(enabled = true) { const proof = useFluidScope(); return useQuery({ queryKey: fluidKeys.rules(proof), queryFn: ({ signal }) => fluidApi.rules({ signal }), enabled, retry: false, staleTime: 0, refetchOnMount: 'always' }); }
const reducer = (state, patch) => ({ ...state, ...patch });
export function useFluidWrite(operation, patientId) {
  const proof = useFluidScope();
  const capture = useScopedNotifications(proof);
  const [state, set] = useReducer(reducer, { busy: false, unknown: false, saved: null, error: null });
  const frozen = useRef(null); const pending = useRef(null); const mounted = useRef(true); const client = useQueryClient();
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  const refresh = () => { void client.invalidateQueries({ queryKey: [...fluidKeys.scope(proof), 'source'] }); void client.invalidateQueries({ queryKey: [...fluidKeys.scope(proof), 'history'] }); void client.invalidateQueries({ queryKey: [...fluidKeys.scope(proof), 'assessment'] }); void client.invalidateQueries({ queryKey: patientId ? fluidKeys.patient(patientId, proof) : fluidKeys.scope(proof) }); void client.invalidateQueries({ queryKey: nursingKeys.fluidBalanceAll() }); void client.invalidateQueries({ queryKey: nursingKeys.fluidBalanceSummaryAll() }); void client.invalidateQueries({ queryKey: nursingKeys.fluidBalanceTrendsAll() }); void client.invalidateQueries({ queryKey: nursingKeys.fluidBalanceTodayAll() }); void client.invalidateQueries({ queryKey: nursingKeys.patientMonitoringAll() }); void client.invalidateQueries({ queryKey: ['ward-board'] }); };
  const submit = async (...args) => {
    if (pending.current || state.saved) return null;
    if (!state.unknown) frozen.current = structuredClone(args);
    const lease = capture(); if (!lease.isCurrent()) return null;
    const controller = new AbortController(); pending.current = controller; set({ busy: true, error: null });
    try { const saved = await fluidApi[operation](...frozen.current, { signal: controller.signal }); if (!mounted.current || !lease.isCurrent()) return null; set({ saved, unknown: false }); refresh(); return saved; }
    catch (error) { if (mounted.current && lease.isCurrent()) { set({ error, unknown: state.unknown || error.name === 'FluidWriteUnconfirmedError' }); refresh(); } return null; }
    finally { pending.current = null; if (mounted.current && lease.isCurrent()) set({ busy: false }); }
  };
  const reset = () => { if (!state.saved || pending.current) return; frozen.current = null; set({ busy: false, unknown: false, saved: null, error: null }); };
  return { ...state, submit, refresh, reset };
}
export function fluidDayScope(patient, admission, date) { const start = new Date(`${date}T00:00:00.000Z`); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1); return { patient_id: patient, ...(admission ? { admission_case_id: admission } : {}), recorded_from: start.toISOString(), recorded_before: end.toISOString(), descending: true }; }
