import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { currentNetworkAuthorityScope } from '@/lib/api/v2/networkAccessGuard';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { authorizationIdentity, authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';

const authorityNow = () => { const value = currentNetworkAuthorityScope(); return value ? hashQueryValue(value) : null; };

/** Capture before awaiting work. A later callback must use that same publisher. */
export function useScopedNotifications(opaqueContext = null) {
  const { user } = useAuth();
  const access = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const rust = isRustV2ApiMode(); const decision = access?.networkDecision;
  const authority = rust ? hashQueryValue(authorizationIdentity(user)) : null;
  const expiresAt = decision?.classification === 'offsite' && decision.mode === 'fresh_reauth' ? Date.parse(decision.reauth_expires_at) : null;
  const eligible = Boolean(user?.id) && (!rust || (access?.networkConfirmed === true && access.canRead === true));
  const scope = hashQueryValue(JSON.stringify([authorizationScope(user, transport), opaqueContext, eligible,
    access?.isReadOnly, decision?.policy_version, decision?.classification, decision?.mode, decision?.reauth_required, expiresAt]));
  const committed = useRef(null);
  useLayoutEffect(() => {
    const lease = { active: eligible, authority, transport, expiresAt }; committed.current = lease;
    return () => { lease.active = false; };
  }, [scope, eligible, authority, transport, expiresAt]);
  return useCallback(() => {
    const origin = committed.current;
    const isCurrent = () => Boolean(origin?.active && committed.current === origin
      && origin.transport === getV2ClientScopeKey() && origin.authority === authorityNow()
      && (origin.expiresAt === null || (Number.isFinite(origin.expiresAt) && Date.now() < origin.expiresAt)));
    const publish = (method) => (...args) => isCurrent() ? toast[method](...args) : undefined;
    return { isCurrent, success: publish('success'), error: publish('error'), warning: publish('warning'), info: publish('info'), message: publish('message') };
  }, []);
}
