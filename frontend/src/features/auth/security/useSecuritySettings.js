import { useLayoutEffect, useReducer, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/lib/api/auth';
import { factorApi } from '../api';
import { browserCeremony } from '../ceremony';
import { authFailure } from '../model';

const initial = { busy: null, feedback: null, codes: [], showCodes: true, unknown: false };
const patch = (state, value) => ({ ...state, ...value });
export function useSecuritySettings(scope, cursor) {
  const [state, set] = useReducer(patch, initial); const operation = useRef(null);
  useLayoutEffect(() => () => operation.current?.abort(), []);
  const keys = useQuery({ queryKey: ['auth-security-keys', scope, cursor || 'first'], queryFn: ({ signal }) => factorApi.keys({ cursor, signal }), retry: false, staleTime: 0, refetchOnMount: 'always' });
  const assurance = useQuery({ queryKey: ['auth-security-assurance', scope], queryFn: ({ signal }) => factorApi.assurance({ signal }), retry: false, staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 15000 });
  const run = async (name, action) => {
    if (operation.current || state.unknown) return;
    const controller = new AbortController(); operation.current = controller; set({ busy: name, feedback: null });
    try {
      const result = await action(controller.signal); if (controller.signal.aborted) return;
      if (name === 'recovery') {
        if (!Array.isArray(result?.codes) || !result.codes.length || result.codes.some((code) => typeof code !== 'string' || !code)) throw new Error('Recovery code replacement could not be confirmed.');
        set({ codes: result.codes, showCodes: true });
      }
      set({ feedback: name === 'recovery' ? 'Recovery codes replaced. Save this new set before leaving.' : 'The security change was confirmed.' });
      await Promise.allSettled([keys.refetch(), assurance.refetch()]);
    } catch (error) {
      if (!controller.signal.aborted) {
        const unknown = !['NotAllowedError', 'SecurityError', 'AbortError'].includes(error.name) && (!error.status || error.status >= 500 || error.data?.error?.code === 'factor_write_unconfirmed');
        set({ unknown, feedback: unknown ? 'The security change could not be confirmed and may already be saved. Review fresh security status before another change. Old recovery codes may already be invalid.' : authFailure(error) });
      }
    } finally { if (operation.current === controller) operation.current = null; if (!controller.signal.aborted) set({ busy: null }); }
  };
  const register = () => run('register', async (signal) => {
    const options = await authApi.mfaWebAuthnRegistrationOptions(null, { signal });
    const assertion = await browserCeremony(options, { signal, registration: true });
    const result = await authApi.mfaWebAuthnRegistrationVerify(assertion.credential, assertion.challenge_id, { signal });
    if (result?.verified !== true) throw new Error('Registration could not be confirmed.');
    return result;
  });
  const rename = (key, label) => run('rename', async (signal) => { const saved = await factorApi.rename(key.id, label, { signal }); if (saved?.id !== key.id || saved.label !== label.trim() || saved.disabled_at !== null) throw new Error('Key name could not be confirmed.'); return saved; });
  const disable = (key) => run('disable', async (signal) => { const saved = await factorApi.disable(key.id, { signal }); if (saved?.id !== key.id || !saved.disabled_at || !Number.isFinite(Date.parse(saved.disabled_at))) throw new Error('Key retirement could not be confirmed.'); return saved; });
  const recover = (password) => run('recovery', (signal) => authApi.mfaRecoveryGenerate({ currentPassword: password, signal }));
  const review = async () => { const results = await Promise.all([keys.refetch(), assurance.refetch()]); if (results.every((result) => !result.isError && result.data)) set({ unknown: false, feedback: 'Fresh status loaded. Review it before deliberately making another change.' }); };
  return { ...state, set, keys, assurance, register, rename, disable, recover, review };
}
