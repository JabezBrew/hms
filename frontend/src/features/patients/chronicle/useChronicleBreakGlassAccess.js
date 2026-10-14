import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { encounterKeys } from '@/features/encounters/hooks/useEncounterQueries';
import { patientsApi } from '@/features/patients/api';
import { patientKeys } from '@/features/patients/hooks/usePatientQueries';
import { timelineKeys } from '@/hooks/useTimelineQueries';
import { getAuthQueryScope } from '@/shared/lib/queryKeys';

const BREAK_GLASS_ROLES = new Set(['admin', 'doctor', 'nurse']);
const MAX_GRANT_MS = 2 * 60 * 60 * 1000;
const initialState = (scope) => ({ scope, open: false, reason: '', category: 'urgent_clinical_continuity', confirmed: false, expiresAt: null, deadline: null, blocked: false, checking: false, error: '', reauthRequired: false });
function reducer(state, action) {
  return { ...(state.scope === action.scope ? state : initialState(action.scope)), ...action.patch };
}

export function useChronicleBreakGlassAccess({ patient, patientId, facilityCode, isLoading, refetchContext, refetchEncounters, refetchPatient, refetchTimeline, rustV2Mode, startupError, user }) {
  const queryClient = useQueryClient();
  const scope = `${patientId}:${getAuthQueryScope({ user, facilityCode })}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [stored, dispatch] = useReducer(reducer, scope, initialState);
  const state = stored.scope === scope ? stored : { ...initialState(scope), blocked: rustV2Mode };
  const patch = useCallback((value) => dispatch({ scope, patch: value }), [scope]);
  const permissions = user?.accessContext?.permissions || user?.access_context?.permissions || user?.permissions || user?.adminAccess?.capabilities || user?.admin_access?.capabilities || [];
  const canRequestBreakGlass = rustV2Mode ? permissions.includes('patient.break_glass.invoke') : BREAK_GLASS_ROLES.has(user?.role || user?.user_type);
  const accessDenied = rustV2Mode
    ? state.blocked || (!isLoading && startupError?.status === 403)
    : patient && !isLoading && patient?.access?.clinical === false;

  const discardPatientData = useCallback(async () => {
    const keys = [patientKeys.detail(patientId), timelineKeys.list(patientId), encounterKeys.forPatient(patientId)];
    await Promise.all(keys.map((queryKey) => queryClient.cancelQueries({ queryKey })));
    keys.forEach((queryKey) => queryClient.removeQueries({ queryKey }));
  }, [patientId, queryClient]);

  const checkRecordAccess = useCallback(async () => {
    patch({ blocked: true, checking: true });
    await discardPatientData();
    if (scopeRef.current !== scope) return;
    try {
      const result = await refetchContext?.();
      if (scopeRef.current !== scope) return;
      if (!result?.data || result.error || result.isError) throw result?.error || new Error('Record access could not be verified.');
      patch({ blocked: false, checking: false, error: '', reauthRequired: false });
    } catch (error) {
      if (scopeRef.current !== scope) return;
      await discardPatientData();
      patch({ blocked: true, checking: false, expiresAt: null, deadline: null, error: error?.status === 403 ? 'Record access was denied. Request emergency access only for urgent clinical need.' : 'Record access could not be verified. The record remains locked; check access again when the connection is available.' });
    }
  }, [discardPatientData, patch, refetchContext, scope]);

  useEffect(() => {
    if (rustV2Mode && stored.scope !== scope) void checkRecordAccess();
  }, [checkRecordAccess, rustV2Mode, scope, stored.scope]);

  useEffect(() => {
    if (!rustV2Mode) return;
    return () => { void discardPatientData(); };
  }, [discardPatientData, rustV2Mode, scope]);

  useEffect(() => {
    if (!rustV2Mode || !canRequestBreakGlass) return;
    const recheck = async () => {
      if (document.hidden) return;
      let result;
      try { result = await refetchContext?.(); } catch (error) { result = { error }; }
      if (scopeRef.current !== scope) return;
      if (result?.error || result?.isError) {
        patch({ blocked: true, expiresAt: null, deadline: null, error: 'Record access could not be verified. Check access again before continuing.' });
        await discardPatientData();
      }
    };
    const interval = setInterval(() => { void recheck(); }, 30_000);
    const onVisible = () => { if (!document.hidden) void recheck(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible); };
  }, [canRequestBreakGlass, discardPatientData, patch, refetchContext, rustV2Mode, scope]);

  useEffect(() => {
    if (!rustV2Mode || state.deadline === null) return;
    const expire = () => {
      patch({ expiresAt: null, deadline: null, blocked: true });
      void checkRecordAccess();
    };
    const timeout = setTimeout(expire, Math.max(0, state.deadline - performance.now()));
    return () => clearTimeout(timeout);
  }, [checkRecordAccess, patch, rustV2Mode, state.deadline]);

  const breakGlassMutation = useMutation({
    retry: false,
    mutationFn: async ({ payload, requestScope, requestPatientId }) => {
      const requestedAt = performance.now();
      return { data: await patientsApi.requestBreakGlass(requestPatientId, payload), scope: requestScope, requestedAt };
    },
    onSuccess: async ({ data, scope: requestScope, requestedAt }) => {
      if (scopeRef.current !== requestScope) return;
      const expiresAt = rustV2Mode ? data?.expires_at : data?.break_glass?.expires_at;
      if (rustV2Mode) {
        const lifetime = Date.parse(expiresAt) - Date.parse(data?.started_at);
        if (data?.patient_id !== patientId || data?.ended_at || !Number.isFinite(lifetime) || lifetime <= 0) {
          patch({ error: 'The grant could not be verified. Check record access before continuing.', blocked: true });
          await discardPatientData();
          return;
        }
        // The monotonic bound also protects against a workstation clock behind
        // the server or changed during the grant. Refresh never extends it.
        const deadline = Math.min(requestedAt + Math.min(lifetime, MAX_GRANT_MS), performance.now() + Math.max(0, Date.parse(expiresAt) - Date.now()));
        patch({ expiresAt, deadline, open: false, reason: '', confirmed: false, error: '' });
        await checkRecordAccess();
      } else {
        patch({ expiresAt, open: false, reason: '' });
        queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
        queryClient.invalidateQueries({ queryKey: timelineKeys.list(patientId) });
        queryClient.invalidateQueries({ queryKey: encounterKeys.forPatient(patientId) });
        refetchPatient?.(); refetchContext?.(); refetchTimeline?.(); refetchEncounters?.();
      }
      toast.success('Emergency access request accepted', { description: 'Record access is checked by the server.' });
    },
    onError: (error, variables) => {
      if (scopeRef.current !== variables.requestScope) return;
      const code = error?.data?.error?.code;
      const message = code === 'reauth_required'
        ? 'Sign out and sign in again to verify your identity, then return to this patient and submit the request.'
        : code === 'break_glass_grant_exists'
          ? 'An emergency grant already exists. Check record access or end emergency access before requesting another grant.'
          : error?.message || 'Emergency access could not be confirmed. Check record access before submitting another request.';
      patch({ error: message, reauthRequired: code === 'reauth_required' });
      toast.error('Emergency access request failed', { description: message });
    },
  });
  const endMutation = useMutation({
    retry: false,
    mutationFn: async ({ requestScope, requestPatientId }) => ({ data: await patientsApi.endBreakGlass(requestPatientId), requestScope }),
    onSuccess: async ({ requestScope }) => {
      if (scopeRef.current !== requestScope) return;
      patch({ expiresAt: null, deadline: null, error: '', blocked: true });
      await checkRecordAccess();
      toast.success('Emergency access ended');
    },
    onError: async (_error, variables) => {
      if (scopeRef.current !== variables.requestScope) return;
      patch({ expiresAt: null, deadline: null, blocked: true, error: 'Ending emergency access could not be confirmed. The record is locked here. Check access or retry ending access.' });
      await discardPatientData();
    },
  });
  const submitBreakGlass = useCallback(() => {
    const reason = state.reason.trim();
    if (!canRequestBreakGlass || reason.length < 6 || reason.length > 500 || (rustV2Mode && !state.confirmed)) return;
    breakGlassMutation.mutate({ payload: rustV2Mode ? { category: state.category, reason_text: reason } : { reason, scope: 'clinical' }, requestScope: scope, requestPatientId: patientId });
  }, [breakGlassMutation, canRequestBreakGlass, patientId, rustV2Mode, scope, state.category, state.confirmed, state.reason]);

  return {
    accessDenied, breakGlassExpiresAt: state.expiresAt, breakGlassReason: state.reason, breakGlassCategory: state.category, breakGlassConfirmed: state.confirmed,
    breakGlassError: state.error, reauthRequired: state.reauthRequired, canRequestBreakGlass, isBreakGlassOpen: state.open,
    isCheckingBreakGlass: state.checking, isEndingBreakGlass: endMutation.isPending, isSubmittingBreakGlass: breakGlassMutation.isPending,
    setBreakGlassOpen: (open) => { if (!breakGlassMutation.isPending) patch({ open }); },
    setBreakGlassReason: (reason) => patch({ reason }), setBreakGlassCategory: (category) => patch({ category }), setBreakGlassConfirmed: (confirmed) => patch({ confirmed }),
    submitBreakGlass, endBreakGlass: () => endMutation.mutate({ requestScope: scope, requestPatientId: patientId }), checkRecordAccess,
  };
}
