import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { patientsApi } from '@/features/patients/api';
import { patientKeys } from '@/features/patients/hooks/usePatientQueries';
import { userHasCapability } from '@/shared/lib/access';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';

const initialState = { grant: null, busy: false, error: null, refreshError: false, blocked: false, unconfirmed: false };
function reducer(state, patch) { return { ...state, ...patch }; }

function assertSameScope(current, authenticated) {
  if (!current?.id || !current.email || !current.facilityCode || !authenticated
    || authenticated.id !== current.id
    || authenticated.facilityCode !== current.facilityCode
    || authenticated.accessContext?.facility_id !== current.accessContext?.facility_id
    || authenticated.accessContext?.active_profile !== current.accessContext?.active_profile
    || !userHasCapability(authenticated, 'patient.break_glass.invoke')) {
    throw new Error('The signed-in account or access scope changed. Reload this record before requesting emergency access.');
  }
}

export function useRustBreakGlassAccess({ enabled, patientId, user, reauthenticate, refetchContext, accessSource }) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, initialState);
  const operationRef = useRef(null);
  const checkedExpiryRef = useRef(null);
  const lastGrantRef = useRef(null);
  const refreshRevisionRef = useRef(0);
  const scope = `${patientId}:${user?.id}:${user?.facilityCode}:${user?.accessContext?.active_profile}`;
  const clientScope = getV2ClientScopeKey();
  const statusKey = useMemo(() => [...patientKeys.detail(patientId), 'emergency-access', clientScope], [patientId, clientScope]);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: ({ signal }) => patientsApi.getBreakGlassStatus(patientId, { signal }),
    enabled: enabled && Boolean(patientId) && userHasCapability(user, 'patient.break_glass.invoke'),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => query.state.data?.grant ? 15_000 : false,
  });
  const grant = status.data ? status.data.grant : state.grant;

  useEffect(() => {
    refreshRevisionRef.current += 1;
    checkedExpiryRef.current = null;
    lastGrantRef.current = null;
    dispatch(initialState);
    return () => operationRef.current?.abort();
  }, [scope]);

  const refreshAccess = useCallback(async () => {
    const revision = ++refreshRevisionRef.current;
    try {
      await queryClient.cancelQueries({ queryKey: patientKeys.detail(patientId) });
      // resetQueries clears cached clinical data and starts active reads. Reuse
      // its in-flight startup request rather than cancelling and fetching twice.
      const [, result] = await Promise.all([
        queryClient.resetQueries({ queryKey: patientKeys.detail(patientId) }),
        refetchContext?.({ cancelRefetch: false }),
      ]);
      if (refreshRevisionRef.current !== revision) return false;
      if (result?.isError || result?.error) throw new Error('Refresh failed');
      dispatch({ refreshError: false, blocked: false });
      return true;
    } catch {
      if (refreshRevisionRef.current === revision) dispatch({ refreshError: true });
      return false;
    }
  }, [patientId, queryClient, refetchContext]);

  useEffect(() => {
    if (!enabled || !grant?.expires_at) return undefined;
    const expiryKey = `${grant.id}:${grant.expires_at}`;
    // A client clock ahead of the server must not create a refetch loop when
    // the server still reports this same grant as active after our timer.
    if (checkedExpiryRef.current === expiryKey) return undefined;
    const delay = Date.parse(grant.expires_at) - Date.now();
    const timer = setTimeout(() => {
      checkedExpiryRef.current = expiryKey;
      queryClient.setQueryData(statusKey, { grant: null });
      dispatch({ grant: null, blocked: true });
      void refreshAccess();
    }, Math.min(2_147_483_647, Math.max(0, delay)));
    return () => clearTimeout(timer);
  }, [enabled, refreshAccess, grant?.id, grant?.expires_at, queryClient, statusKey]);

  useEffect(() => {
    const previous = lastGrantRef.current;
    lastGrantRef.current = grant?.id || null;
    const appeared = grant && grant.id !== previous && Date.parse(grant.expires_at) > Date.now();
    const ended = previous && !grant;
    if (enabled && (appeared || ended) && !operationRef.current && !state.blocked) {
      dispatch({ blocked: true });
      void refreshAccess();
    }
  }, [enabled, grant, refreshAccess, state.blocked]);

  const submit = async ({ password, category, reason }) => {
    if (!enabled || operationRef.current || grant || state.refreshError || state.unconfirmed || !status.data || status.isError) return false;
    if (!password || !category || !userHasCapability(user, 'patient.break_glass.invoke')) return false;
    const controller = new AbortController();
    operationRef.current = controller;
    dispatch({ busy: true, error: null });
    let grantAttempted = false;
    try {
      const authenticated = await reauthenticate(user.email, password, user.facilityCode);
      if (controller.signal.aborted) return false;
      assertSameScope(user, authenticated);
      grantAttempted = true;
      const grant = await patientsApi.requestBreakGlass(patientId, {
        category, reason_text: reason?.trim() || undefined,
      }, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      if (!grant?.id || grant.patient_id !== patientId || grant.user_id !== user.id
        || grant.facility_id !== user.accessContext?.facility_id || !Number.isFinite(Date.parse(grant.expires_at))) {
        throw new Error('Emergency access could not be confirmed. Refresh this record before requesting another grant.');
      }
      const summary = { id: grant.id, expires_at: grant.expires_at };
      queryClient.setQueryData(statusKey, { grant: summary });
      dispatch({ grant: summary, blocked: false, unconfirmed: false });
      await refreshAccess();
      if (controller.signal.aborted) return false;
      return true;
    } catch (error) {
      if (!controller.signal.aborted) {
        const unconfirmed = grantAttempted && !(error?.status >= 400 && error?.status < 500);
        dispatch({ unconfirmed, error: unconfirmed
          ? 'The emergency access request could not be confirmed. A grant may already exist. End any grant before requesting access again.'
          : error?.message || 'Emergency access could not be granted.' });
      }
      return false;
    } finally {
      if (operationRef.current === controller) operationRef.current = null;
      if (!controller.signal.aborted) dispatch({ busy: false });
    }
  };

  const end = async () => {
    if (!enabled || operationRef.current) return;
    const controller = new AbortController();
    operationRef.current = controller;
    refreshRevisionRef.current += 1;
    dispatch({ busy: true, error: null, blocked: true });
    try {
      const response = await patientsApi.endBreakGlass(patientId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!Number.isInteger(response?.ended_count)) throw new Error('Ending emergency access could not be confirmed. Refresh and try ending access again.');
      queryClient.setQueryData(statusKey, { grant: null });
      dispatch({ grant: null, blocked: true, unconfirmed: false });
      await refreshAccess();
    } catch (error) {
      if (!controller.signal.aborted) {
        const unconfirmed = !(error?.status >= 400 && error?.status < 500);
        dispatch({ unconfirmed, error: unconfirmed
          ? 'Ending emergency access could not be confirmed. The grant may already have ended. Refresh authorization or try ending access again.'
          : error?.message || 'Emergency access could not be ended.' });
        await refreshAccess();
      }
    } finally {
      if (operationRef.current === controller) operationRef.current = null;
      if (!controller.signal.aborted) dispatch({ busy: false });
    }
  };

  return {
    ...state, grant, blocked: state.blocked || (status.isError && accessSource === 'break_glass'),
    statusError: status.isError, statusLoading: status.isLoading, submit, end,
    refreshAccess: state.refreshError ? refreshAccess : status.refetch,
  };
}
