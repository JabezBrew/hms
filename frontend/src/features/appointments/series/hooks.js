import { useEffect, useReducer, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { appointmentKeys } from '../hooks/useAppointmentQueries';
import { seriesApi } from './api';
export const seriesKeys = {
  root: ['appointment-series'],
  detail: (id) => ['appointment-series', getV2ClientScopeKey(), 'detail', id],
  slots: (query) => ['appointment-series', getV2ClientScopeKey(), 'slots', query],
};
export function useAppointmentSeries(id) {
  return useQuery({ queryKey: seriesKeys.detail(id), queryFn: ({ signal }) => seriesApi.get(id, { signal }), enabled: Boolean(id), retry: false, staleTime: 0, refetchOnMount: 'always' });
}
export function useSeriesSlots(query, enabled) {
  return useQuery({ queryKey: seriesKeys.slots(query), queryFn: ({ signal }) => seriesApi.slots(query, { signal }), enabled, retry: false, staleTime: 0, gcTime: 0 });
}
function reducer(state, patch) { return { ...state, ...patch }; }
/** Keep a potentially committed payload in local memory, never in automatic retries. */
export function useSeriesWrite(operation) {
  const [state, set] = useReducer(reducer, { busy: false, saved: null, error: null, unknown: false, recovered: false });
  const frozen = useRef(null); const active = useRef(null); const mounted = useRef(true);
  const client = useQueryClient();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: seriesKeys.root });
    void client.invalidateQueries({ queryKey: appointmentKeys.all });
    void client.invalidateQueries({ queryKey: ['scheduling'] });
  };
  const submit = async (...args) => {
    if (active.current || state.saved) return null;
    if (!state.unknown) frozen.current = structuredClone(args);
    const controller = new AbortController(); active.current = controller;
    set({ busy: true, error: null });
    try {
      const saved = await seriesApi[operation](...frozen.current, { signal: controller.signal, currentMembership: state.unknown });
      if (mounted.current) { set({ saved, unknown: false, recovered: state.unknown }); refresh(); }
      return saved;
    } catch (error) {
      if (mounted.current) { set({ error, unknown: state.unknown || error.name === 'AppointmentSeriesUnconfirmedError' }); refresh(); }
      return null;
    } finally { if (mounted.current) set({ busy: false }); active.current = null; }
  };
  const recover = async (requestId) => {
    if (active.current || state.saved) return null;
    const controller = new AbortController(); active.current = controller; set({ busy: true, error: null });
    try {
      const saved = await seriesApi.recover(requestId, { signal: controller.signal, expected: frozen.current?.[0] });
      if (mounted.current) { set({ saved, unknown: false, recovered: true }); refresh(); }
      return saved;
    } catch { if (mounted.current) set({ error: new Error('The saved result could not be confirmed. Keep this request unchanged; you can retry the same booking request.'), unknown: true }); return null; }
    finally { if (mounted.current) set({ busy: false }); active.current = null; }
  };
  return { ...state, submit, recover };
}
