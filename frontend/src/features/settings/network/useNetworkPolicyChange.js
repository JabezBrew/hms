import { useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { waitForNetworkWriteAccess } from '@/lib/api/v2/networkAccessGuard';
import { userHasCapability } from '@/shared/lib/access';
import { networkApi } from './api';
import { assertNetworkAuthority, NETWORK_ADMIN_CAPABILITY, networkAccessScope, networkEditorIdentity } from './model';
import { networkKeys } from './hooks';

const initial = { busy: false, checked: null, error: null, unknown: false, saved: null, refreshFailed: false };
const patch = (state, value) => ({ ...state, ...value });
export function useNetworkPolicyChange({ user, policy, reauthenticate }) {
  const [state, set] = useReducer(patch, initial);
  const pending = useRef(null); const mounted = useRef(true); const frozen = useRef(null);
  const client = useQueryClient();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  const start = () => {
    if (pending.current || state.saved || !userHasCapability(user, NETWORK_ADMIN_CAPABILITY)) return null;
    const controller = new AbortController(); pending.current = controller; set({ busy: true, error: null }); return controller;
  };
  const finish = () => { pending.current = null; if (mounted.current) set({ busy: false }); };
  const authenticate = async (password, controller) => {
    if (!password) throw new Error('Confirm your current password to review this change.');
    const authenticated = await reauthenticate(user.email, password, user.facilityCode, { signal: controller.signal });
    if (controller.signal.aborted) return false;
    assertNetworkAuthority(user, authenticated);
    const decision = await networkApi.current({ signal: controller.signal });
    if (controller.signal.aborted) return false;
    if (!decision.access_allowed || decision.read_only || decision.classification === 'unknown' || decision.policy_version === null) throw new Error('The current connection remains restricted after credential confirmation. Use an approved connection before reviewing network changes.');
    const transportScope = getV2ClientScopeKey();
    client.setQueryData(networkKeys.current(networkAccessScope(authenticated, transportScope)), decision);
    await waitForNetworkWriteAccess({ transportScope, authorityScope: networkEditorIdentity(authenticated), signal: controller.signal });
    return true;
  };
  const preview = async ({ candidate, reason, password }) => {
    if (state.unknown) return false;
    const controller = start(); if (!controller) return false;
    try {
      if (!await authenticate(password, controller)) return false;
      const result = await networkApi.preview(candidate, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      if (!result.current_connection_retained_onsite || result.candidate_access.classification !== 'onsite') throw new Error('This change would remove this connection from the approved networks. Keep this connection approved before publishing.');
      set({ checked: { ...result, reason } }); return true;
    } catch (error) { if (mounted.current) set({ error: error.message || 'The candidate policy could not be checked.' }); return false; }
    finally { finish(); }
  };
  const publish = async (password) => {
    if (!state.unknown && !state.checked) return false;
    const controller = start(); if (!controller) return false;
    let writeStarted = false;
    try {
      if (state.unknown && !await authenticate(password, controller)) return false;
      if (!frozen.current) frozen.current = structuredClone({ client_request_id: crypto.randomUUID(), expected_version: policy.version,
        ...state.checked.candidate, reason: state.checked.reason });
      writeStarted = true;
      const saved = await networkApi.save(frozen.current, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      set({ saved, unknown: false });
      try { await client.invalidateQueries({ queryKey: networkKeys.root }, { throwOnError: true }); }
      catch { if (mounted.current) set({ refreshFailed: true }); }
      return true;
    } catch (error) {
      if (mounted.current) {
        const unknown = state.unknown || (writeStarted && error.name === 'NetworkPolicyUnconfirmedError');
        set({ unknown, error: unknown ? 'The policy may already be saved. The reviewed networks, mode, reason and request reference are locked. Confirm your password to retry this exact change, or refresh the current policy.' : error.message || 'Network policy could not be changed.' });
        if (!unknown) { frozen.current = null; set({ checked: null }); }
      }
      return false;
    } finally { finish(); }
  };
  const edit = () => { if (!pending.current && !state.unknown && !state.saved) { frozen.current = null; set({ checked: null, error: null }); } };
  return { ...state, preview, publish, edit };
}
