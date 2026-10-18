import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ROLE_GROUPS } from '@/shared/constants/roles';
import { userCanAccess } from '@/shared/lib/access';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getWriteUncertaintySnapshot, subscribeWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { storageLocationApi } from './api';
import { storageLocationKeys } from './keys';
import { LOCATION_TYPES, TEMPERATURE_ZONES } from './model';
import { useStorageLocationAccess } from './useStorageLocationAccess';
import { useStorageLocationCommand } from './useStorageLocationCommand';
import { DirectoryFilters, DirectoryPagination } from './components/DirectoryControls';
import { StorageLocationChangeDialog } from './components/StorageLocationChangeDialog';
import { StorageLocationReloadRecovery } from './components/StorageLocationReloadRecovery';
function DirectoryTable({ rows, onSelect, disabled, canManage, onStock }) {
  return <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Storage classification</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{rows.map(location => <TableRow key={location.id}><TableCell className="max-w-72 whitespace-normal break-words"><p className="font-medium">{location.name}</p><p className="mt-1 text-xs text-muted-foreground">{location.code} · Version {location.version}</p></TableCell><TableCell className="max-w-64 whitespace-normal break-words"><p>{LOCATION_TYPES[location.location_type] || location.location_type}</p><p className="mt-1 text-xs text-muted-foreground">{TEMPERATURE_ZONES[location.temperature_zone] || location.temperature_zone}</p></TableCell><TableCell><Badge variant="secondary">{location.is_active ? 'Active' : 'Inactive'}</Badge></TableCell><TableCell><div className="flex flex-wrap gap-2">{onStock && location.is_active && <Button type="button" size="sm" variant="outline" onClick={() => onStock(location.id)} aria-label={`View stock at ${location.name}`}>View stock</Button>}{canManage ? <><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onSelect({ action: 'rename', location })} aria-label={`Rename ${location.name}`}>Rename</Button><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onSelect({ action: location.is_active ? 'retire' : 'reactivate', location })} aria-label={`${location.is_active ? 'Retire' : 'Reactivate'} ${location.name}`}>{location.is_active ? 'Retire' : 'Reactivate'}</Button></> : <span className="text-xs text-muted-foreground">View only</span>}</div></TableCell></TableRow>)}</TableBody></Table></div>;
}
function Unavailable({ onRetry }) { return <PageShell><PageState variant="error" title="Storage location administration unavailable" description="Current inventory view authority, demographics access and the Inventory feature are required. Protected location content and local review copies are hidden." action={onRetry} /></PageShell>; }
function Directory({ access, onDenied }) {
  const client = useQueryClient(), navigate = useNavigate();
  const onStock = userCanAccess(access.user, { roles: ROLE_GROUPS.INVENTORY }) ? id => navigate(`/inventory/items?location=${id}`) : null;
  const [paging, setPaging] = useState({ location_type: '', temperature_zone: '', search: '', status: 'active', cursors: [null], page: 0 });
  const [selection, setSelection] = useState(null), [open, setOpen] = useState(false), [finishing, setFinishing] = useState(false), [error, setError] = useState(null);
  const params = { limit: 25, ...(paging.location_type ? { location_type: paging.location_type } : {}), ...(paging.temperature_zone ? { temperature_zone: paging.temperature_zone } : {}), ...(paging.search ? { search: paging.search } : {}), ...(paging.status !== '' ? { is_active: paging.status === 'active' } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const query = useQuery({ queryKey: storageLocationKeys.page(access.scope, params), queryFn: ({ signal }) => storageLocationApi.list(params, { signal }), enabled: access.canRead, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const sourceToken = useMemo(() => ({ data: query.data, error: query.error, updatedAt: query.dataUpdatedAt }), [query.data, query.error, query.dataUpdatedAt]);
  const refresh = () => client.invalidateQueries({ queryKey: storageLocationKeys.all(access.scope) }, { throwOnError: true });
  const controller = useStorageLocationCommand(access.scope, access.canWrite, onDenied, refresh);
  const barrier = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot);
  const blocked = barrier.unavailable || barrier.entries.length > 0;
  const denied = query.error?.status === 403; useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  if (denied) return <Unavailable />;
  const select = value => { if (controller.locked || blocked || !access.canWrite) return; setSelection(value); setOpen(true); setError(null); };
  const next = () => { const cursor = query.data?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); };
  const done = async () => { setFinishing(true); setError(null); try { await refresh(); controller.reset(); setSelection(null); setOpen(false); } catch { setError('The directory could not be refreshed. The original receipt remains confirmed; refresh before another change.'); } finally { setFinishing(false); } };
  const rowDisabled = controller.locked || blocked || query.isFetching || query.isError || !access.canWrite || finishing;
  return <PageShell><PageHeader title="Storage locations" description="Keep storage names and active status clear while preserving permanent classifications, stock and operational history." actions={<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={query.isFetching || controller.busy} onClick={() => query.refetch()}>Refresh directory</Button>{controller.locked && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Review pending change</Button>}<Button type="button" disabled={rowDisabled} onClick={() => select({ action: 'create' })}>Create location</Button></div>} />
    <div className="grid min-w-0 gap-6 p-4 sm:p-6"><DirectoryFilters state={paging} onChange={filters => setPaging({ ...filters, cursors: [null], page: 0 })} disabled={controller.busy} />
      {!access.canWrite && <Alert><AlertTitle>Directory is read-only</AlertTitle><AlertDescription>Browsing remains available. Changes require inventory management authority, network access and current server-confirmed credentials.</AlertDescription></Alert>}
      {blocked && !controller.unknown && <Alert><AlertTitle>A previous change needs review</AlertTitle><AlertDescription>Resolve the existing recovery notice before submitting a new storage location change. A directory refresh cannot confirm that earlier change.</AlertDescription></Alert>}
      {blocked && !controller.locked && access.canManage && <StorageLocationReloadRecovery {...{ access, onDenied }} />}
      {error && <p role="alert">{error}</p>}
      {query.isLoading ? <PageState variant="loading" title="Loading storage locations" fullHeight={false} /> : query.isError ? <PageState variant="error" title="Storage locations could not be loaded" description="Cached locations are hidden until a current request succeeds." action={() => query.refetch()} fullHeight={false} /> : query.data?.data.length ? <DirectoryTable rows={query.data.data} onSelect={select} disabled={rowDisabled} canManage={access.canManage} onStock={onStock} /> : <PageState variant="empty" title="No locations on this page" description="Change the search, type, temperature zone or status filters to browse other locations." fullHeight={false} />}
      <DirectoryPagination page={paging.page} hasNext={!query.isError && query.data?.page.has_next} busy={query.isFetching || controller.busy} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={next} />
      <aside className="grid gap-2 rounded-xl border bg-muted/20 p-4"><h2 className="font-medium">Preserve stock and operational history</h2><p className="text-sm text-muted-foreground">Names can be corrected even when a location has been used. Retirement and reactivation here are limited to unused locations; recorded stock or operational history blocks an active-state change. Used-location closeout, stock adjustments and item administration are separate workflows.</p></aside>
    </div>
    {selection && <StorageLocationChangeDialog key={`${selection.action}:${selection.location?.id || 'new'}`} {...{ selection, open, access, controller, onDenied }} onClose={() => { if (!controller.busy && !finishing) setOpen(false); }} onDone={done} finishing={finishing} sourceToken={sourceToken} />}
  </PageShell>;
}
function AuthorizedDirectory({ access }) {
  const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0); const onDenied = useCallback(() => setDenied(true), []);
  return denied ? <Unavailable onRetry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <Directory key={generation} access={access} onDenied={onDenied} />;
}
export default function StorageLocationDirectoryPage() {
  usePageMeta({ title: 'Storage locations', breadcrumbs: [{ label: 'Inventory', path: '/inventory' }, { label: 'Locations', path: '/inventory/locations' }] });
  const access = useStorageLocationAccess();
  return access.canRead ? <AuthorizedDirectory key={access.scope} access={access} /> : <Unavailable />;
}
