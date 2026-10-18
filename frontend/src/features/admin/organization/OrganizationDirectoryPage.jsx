import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getWriteUncertaintySnapshot, subscribeWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { organizationApi } from './api';
import { organizationKeys } from './keys';
import { UNIT_TYPES, parentLabel } from './model';
import { useOrganizationAccess } from './useOrganizationAccess';
import { useOrganizationCommand } from './useOrganizationCommand';
import { DirectoryFilters, DirectoryPagination } from './components/DirectoryControls';
import { OrganizationReloadRecovery } from './components/OrganizationReloadRecovery';
import { OrganizationChangeDialog } from './components/OrganizationChangeDialog';
function DirectoryTable({ rows, onSelect, disabled }) {
  return <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Unit</TableHead><TableHead>Type and parent</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{rows.map(unit => <TableRow key={unit.id}><TableCell className="max-w-72 whitespace-normal break-words"><p className="font-medium">{unit.name}</p><p className="mt-1 text-xs text-muted-foreground">{unit.code} · Version {unit.version}</p></TableCell><TableCell className="max-w-64 whitespace-normal break-words"><p>{UNIT_TYPES[unit.unit_type]}</p><p className="mt-1 text-xs text-muted-foreground">{parentLabel(unit)}</p></TableCell><TableCell><Badge variant="secondary">{unit.is_active ? 'Active' : 'Inactive'}</Badge></TableCell><TableCell><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onSelect({ action: 'rename', unit })} aria-label={`Rename ${unit.name}`}>Rename</Button><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onSelect({ action: unit.is_active ? 'retire' : 'reactivate', unit })} aria-label={`${unit.is_active ? 'Retire' : 'Reactivate'} ${unit.name}`}>{unit.is_active ? 'Retire' : 'Reactivate'}</Button></div></TableCell></TableRow>)}</TableBody></Table></div>;
}
function Unavailable({ onRetry }) { return <PageShell><PageState variant="error" title="Organization administration unavailable" description="Current organization management authority and the Admin feature are required. Protected unit content and local review copies are hidden." action={onRetry} /></PageShell>; }
function Directory({ access, onDenied }) {
  const client = useQueryClient();
  const [paging, setPaging] = useState({ unit_type: '', status: 'active', cursors: [null], page: 0 });
  const [selection, setSelection] = useState(null), [open, setOpen] = useState(false), [finishing, setFinishing] = useState(false), [error, setError] = useState(null);
  const params = { limit: 25, ...(paging.unit_type ? { unit_type: paging.unit_type } : {}), ...(paging.status !== 'all' ? { is_active: paging.status === 'active' } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const query = useQuery({ queryKey: organizationKeys.page(access.scope, params), queryFn: ({ signal }) => organizationApi.list(params, { signal }), enabled: access.canRead, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const sourceToken = useMemo(() => ({ data: query.data, error: query.error, updatedAt: query.dataUpdatedAt }), [query.data, query.error, query.dataUpdatedAt]);
  const refresh = () => client.invalidateQueries({ queryKey: organizationKeys.all(access.scope) }, { throwOnError: true });
  const controller = useOrganizationCommand(access.scope, onDenied, refresh);
  const barrier = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot);
  const blocked = barrier.unavailable || barrier.entries.length > 0;
  const denied = query.error?.status === 403; useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  if (denied) return <Unavailable />;
  const select = value => { if (controller.locked || blocked || !access.canWrite) return; setSelection(value); setOpen(true); setError(null); };
  const next = () => { const cursor = query.data?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); };
  const done = async () => { setFinishing(true); setError(null); try { await refresh(); controller.reset(); setSelection(null); setOpen(false); } catch { setError('The directory could not be refreshed. The original receipt remains confirmed; refresh before another change.'); } finally { setFinishing(false); } };
  const rowDisabled = controller.locked || blocked || query.isFetching || query.isError || !access.canWrite || finishing;
  return <PageShell><PageHeader title="Organization" description="Maintain a clear directory of facility units. Review names and active status while preserving permanent codes, parent links and history." actions={<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={query.isFetching || controller.busy} onClick={() => query.refetch()}>Refresh directory</Button>{controller.locked && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Review pending change</Button>}<Button type="button" disabled={rowDisabled} onClick={() => select({ action: 'create' })}>Create unit</Button></div>} />
    <div className="grid min-w-0 gap-6 p-4 sm:p-6"><DirectoryFilters state={paging} onChange={filters => setPaging({ ...filters, cursors: [null], page: 0 })} disabled={controller.busy} />
      {!access.canWrite && <Alert><AlertTitle>Directory is read-only</AlertTitle><AlertDescription>Browsing is available. Changes require current management authority, network access and server-confirmed identity proof.</AlertDescription></Alert>}
      {blocked && !controller.unknown && <Alert><AlertTitle>A previous change needs review</AlertTitle><AlertDescription>Resolve the existing recovery notice before submitting a new organization change. A directory refresh cannot confirm that earlier change.</AlertDescription></Alert>}
      {blocked && !controller.locked && <OrganizationReloadRecovery {...{ access, onDenied }} />}
      {error && <p role="alert">{error}</p>}
      {query.isLoading ? <PageState variant="loading" title="Loading organization units" fullHeight={false} /> : query.isError ? <PageState variant="error" title="Organization units could not be loaded" description="Cached units are hidden until a current request succeeds." action={() => query.refetch()} fullHeight={false} /> : query.data?.data.length ? <DirectoryTable rows={query.data.data} onSelect={select} disabled={rowDisabled} /> : <PageState variant="empty" title="No units on this page" description="Change the type or status filters to browse other units." fullHeight={false} />}
      <DirectoryPagination page={paging.page} hasNext={!query.isError && query.data?.page.has_next} busy={query.isFetching || controller.busy} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={next} />
      <aside className="grid gap-2 rounded-xl border bg-muted/20 p-4"><h2 className="font-medium">Staffing and service setup</h2><p className="text-sm text-muted-foreground">Staff membership, leadership assignments, cross-unit coverage and department–clinic service links are not available in this directory. Creating or reactivating a unit does not assign or restore those relationships.</p></aside>
    </div>
    {selection && <OrganizationChangeDialog key={`${selection.action}:${selection.unit?.id || 'new'}`} {...{ selection, open, access, controller, onDenied }} onClose={() => { if (!controller.busy && !finishing) setOpen(false); }} onDone={done} finishing={finishing} sourceToken={sourceToken} />}
  </PageShell>;
}
function AuthorizedDirectory({ access }) {
  const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0); const onDenied = useCallback(() => setDenied(true), []);
  return denied ? <Unavailable onRetry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <Directory key={generation} access={access} onDenied={onDenied} />;
}
export default function OrganizationDirectoryPage() {
  usePageMeta({ title: 'Organization', breadcrumbs: [{ label: 'Organization', path: '/admin/organization' }] });
  const access = useOrganizationAccess();
  return access.canRead ? <AuthorizedDirectory key={access.scope} access={access} /> : <Unavailable />;
}
