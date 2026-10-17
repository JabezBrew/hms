import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { userHasCapability } from '@/shared/lib/access';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { Button } from '@/components/ui/button';
import { NetworkAccessNotice } from './NetworkAccessNotice';
import { NetworkPolicyEditor } from './NetworkPolicyEditor';
import { NETWORK_ADMIN_CAPABILITY } from './model';
import { useNetworkPolicy } from './hooks';
import { useV2TransportScope } from './hooks';
import { workflowAuthorizationIdentity } from '@/shared/lib/authorizationScope';

function PolicyWorkspace({ user, reauthenticate }) {
  const query = useNetworkPolicy(true); const [verified, setVerified] = useState(null);
  const fresh = query.isFetchedAfterMount && !query.isFetching && !query.isError;
  useEffect(() => { if (!verified && fresh && query.data) setVerified(query.data); }, [verified, fresh, query.data]);
  const reload = async () => { const result = await query.refetch(); if (!result.isError && result.data) setVerified(result.data); };
  if (!verified) return query.isError ? <PageState variant="error" title="Network policy unavailable" description="The server could not confirm this facility's policy." action={() => query.refetch()} /> : <PageState variant="loading" title="Checking facility network policy" />;
  return <div className="mx-auto grid w-full max-w-3xl gap-5 p-4 sm:p-6"><NetworkAccessNotice decision={query.data?.current_access} loading={!query.isFetchedAfterMount || query.isFetching} error={query.isError} onRefresh={() => query.refetch()} />
    {!verified.policy.configured ? <PageState variant="empty" fullHeight={false} title="Operator setup required" description="An operator must establish the initial approved CIDRs and trusted proxy configuration. Network policy cannot be bootstrapped from this page." />
      : !verified.can_update ? <PageState variant="denied" fullHeight={false} title="Network policy changes unavailable" description="Use a verified approved network, or the facility's permitted fresh sign-in flow, before starting a policy review." />
        : <NetworkPolicyEditor key={verified.policy.version} policy={verified.policy} user={user} reauthenticate={reauthenticate} readStale={!query.isFetchedAfterMount || query.isError || query.data?.can_update !== true} onRefresh={() => query.refetch()} onReload={reload} />}
    <p className="text-xs text-muted-foreground">Trusted proxy ranges and transport settings are managed by the deployment operator. Matching an approved network does not replace user authorization.</p><Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh policy status</Button>
  </div>;
}
export default function NetworkPolicyPage() {
  const meta = usePageMeta({ title: 'Network access', breadcrumbs: [{ label: 'Settings', path: '/settings' }, { label: 'Network access' }] });
  const { user, login: legacyLogin, reauthenticate } = useAuth(); const login = reauthenticate || legacyLogin; const allowed = isRustV2ApiMode() && userHasCapability(user, NETWORK_ADMIN_CAPABILITY);
  const transport = useV2TransportScope();
  return <PageShell>{meta}<PageHeader title="Network access" description="Review approved facility networks and offsite workflow access." />{allowed ? <PolicyWorkspace key={workflowAuthorizationIdentity(user, transport)} user={user} reauthenticate={login} /> : <PageState variant="denied" title="Network administration access required" description="An authorized facility administrator can review network access policy." />}</PageShell>;
}
