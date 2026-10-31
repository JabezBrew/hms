import { lazy, Suspense, useCallback, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { requestAuthorizationScope } from '@/shared/lib/authorizationScope';
import { inventoryKeys } from '@/hooks/useInventoryQueries';
import { PageState } from '@/shared/components/page/PageState';
import { canReadCatalog } from '../catalog/access';
import { canReadTransferList } from './access';
const CurrentPage = lazy(() => import('../pages/TransferRequestsPage'));
const loading = <PageState variant="loading" title="Confirming current transfer access" />;
function ScopedTransferPage({ scope, labelsAvailable, onReadState }) {
  const client = useQueryClient(), [prepared, setPrepared] = useState(false);
  useLayoutEffect(() => {
    // These compatibility queries predate scoped keys. Clear only their list
    // caches before their hooks mount; an old owner's rows never flash first.
    const clear = () => { client.removeQueries({ queryKey: [...inventoryKeys.transferRequests(), 'scoped-list', scope] }); client.removeQueries({ queryKey: [...inventoryKeys.locations(), 'scoped-list', scope] }); };
    clear(); setPrepared(true); return clear;
  }, [client, scope]);
  return prepared ? <Suspense fallback={loading}><CurrentPage readScope={scope} locationLabelsAvailable={labelsAvailable} onReadState={onReadState} /></Suspense> : loading;
}
export default function TransferRoute() {
  const { user } = useAuth(), network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const [, readChanged] = useState(0), onReadState = useCallback(() => readChanged(old => old + 1), []);
  if (!isRustV2ApiMode()) return <Suspense fallback={loading}><CurrentPage /></Suspense>;
  const ready = canReadTransferList(user) && network?.networkConfirmed === true && network.canRead === true && networkClockCurrent(network.networkDecision);
  if (!ready) return <PageState variant="error" title="Transfer requests unavailable" description="Current inventory or pharmacy list authority, demographics visibility and a confirmed connection are required. Previous list and form choices are hidden." />;
  return <ScopedTransferPage key={requestAuthorizationScope(user, transport)} scope={requestAuthorizationScope(user, transport)} labelsAvailable={canReadCatalog(user)} onReadState={onReadState} />;
}
