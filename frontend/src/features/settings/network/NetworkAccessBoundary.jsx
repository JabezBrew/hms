import { Fragment, lazy, Suspense, useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getV2ClientScopeKey } from '@/lib/api/v2/client';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { userHasCapability } from '@/shared/lib/access';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { Button } from '@/components/ui/button';
import { NetworkAccessNotice } from './NetworkAccessNotice';
import { NetworkSessionConfirmation } from './NetworkSessionConfirmation';
import { NETWORK_ADMIN_CAPABILITY, networkAccessScope } from './model';
import { networkKeys, useNetworkAccessDecision } from './hooks';
import { restrictExpiredDecision } from './useNetworkDecisionExpired';
import { useNetworkRequestGuard } from './useNetworkRequestGuard';
import { WriteRecoveryNotice } from './WriteRecoveryNotice';
import { workflowAuthorizationIdentity } from '@/shared/lib/authorizationScope';
import { getWorkflowContinuity, subscribeWorkflowContinuity } from '@/shared/lib/workflowContinuity';
import { useV2TransportScope } from './hooks';

const NetworkPolicyPage = lazy(() => import('./NetworkPolicyPage'));
function AuthoritativeBoundary({ user, login, logout, sessionReady, children }) {
  const query = useNetworkAccessDecision(Boolean(user) && sessionReady); const client = useQueryClient(); const { pathname } = useLocation(); const [confirming, setConfirming] = useState(false);
  const decision = useMemo(() => restrictExpiredDecision(query.data, query.expired), [query.data, query.expired]);
  const confirmed = sessionReady && (query.isFetchedAfterMount || query.stagedConfirmed) && !query.isError && Boolean(decision);
  const requestReauthentication = useCallback(() => setConfirming(true), []);
  const network = useMemo(() => ({ decision, confirmed, requestReauthentication }), [decision, confirmed, requestReauthentication]);
  useNetworkRequestGuard(user, network);
  const canRead = confirmed && decision.access_allowed;
  const denied = (query.isError && query.error?.status === 403) || (confirmed && !decision.access_allowed);
  const [retained, setRetained] = useState(null);
  const workflowProof = JSON.stringify([decision?.policy_version, decision?.classification, decision?.read_only, decision?.access_allowed, decision?.reauth_required]);
  useLayoutEffect(() => { if (denied) setRetained(null); else if (canRead) setRetained(workflowProof); }, [denied, canRead, workflowProof]);
  const canManage = userHasCapability(user, NETWORK_ADMIN_CAPABILITY);
  const policyWorkspace = pathname === '/settings/network-access' && canManage;
  const verified = (value) => { client.setQueryData(networkKeys.current(networkAccessScope(user, getV2ClientScopeKey())), value); setConfirming(false); };
  return <ReadOnlyModeProvider network={network}>{!policyWorkspace && !denied && (canRead || retained) && <div hidden={!canRead} aria-hidden={!canRead || undefined} {...(!canRead ? { inert: '' } : {})}><Fragment key={canRead ? workflowProof : retained}>{children}</Fragment></div>}{(!canRead || policyWorkspace) && <div className="min-h-svh bg-background"><WriteRecoveryNotice />
    {policyWorkspace ? <Suspense fallback={<PageState variant="loading" title="Loading network administration" />}><NetworkPolicyPage /></Suspense> : <PageShell><PageHeader title="Network access" description="The server must confirm this connection before clinical workspaces can open." /><div className="mx-auto grid w-full max-w-2xl gap-5 p-4 sm:p-6"><NetworkAccessNotice decision={decision} loading={!query.isFetchedAfterMount || query.isPending} error={query.isError} onRefresh={() => query.refetch()} onReauthenticate={() => setConfirming(true)} />{canManage && <Button asChild variant="outline"><Link to="/settings/network-access">Review facility network policy</Link></Button>}</div></PageShell>}
    <div className="mx-auto flex max-w-2xl flex-wrap gap-3 p-4 sm:p-6"><Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh connection</Button>{policyWorkspace && decision?.reauth_required && <Button type="button" onClick={() => setConfirming(true)}>Confirm current password</Button>}<Button type="button" variant="ghost" onClick={logout}>Sign out</Button>{pathname === '/settings/network-access' && <Button asChild variant="ghost"><Link to="/">Return to workspace</Link></Button>}</div>
  </div>}{confirming && <NetworkSessionConfirmation user={user} reauthenticate={login} onVerified={verified} onClose={() => setConfirming(false)} />}</ReadOnlyModeProvider>;
}
export function NetworkAccessBoundary({ children }) {
  const { user, login, reauthenticate, logout, sessionReady = true, workspaceInstanceKey } = useAuth();
  const transport = useV2TransportScope();
  useSyncExternalStore(subscribeWorkflowContinuity, getWorkflowContinuity, () => null);
  return isRustV2ApiMode() ? <AuthoritativeBoundary key={workspaceInstanceKey || workflowAuthorizationIdentity(user, transport)} user={user} login={reauthenticate || login} logout={logout} sessionReady={sessionReady}>{children}</AuthoritativeBoundary> : <ReadOnlyModeProvider>{children}</ReadOnlyModeProvider>;
}
