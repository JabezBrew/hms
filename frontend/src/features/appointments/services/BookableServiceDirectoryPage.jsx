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
import { serviceApi } from './api';
import { serviceKeys } from './keys';
import { validDuration } from './model';
import { serviceCode, serviceName } from './presentation';
import { useBookableServiceAccess } from './useBookableServiceAccess';
import { useBookableServiceCommand } from './useBookableServiceCommand';
import { DirectoryFilters, DirectoryPagination } from './components/DirectoryControls';
import { ServiceChangeDialog } from './components/ServiceChangeDialog';
import { ServiceReloadRecovery } from './components/ServiceReloadRecovery';

function DirectoryTable({ rows, onSelect, disabled, canManage }) {
  return <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Service</TableHead><TableHead>Default duration</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{rows.map(service => <TableRow key={service.id}><TableCell className="min-w-48 max-w-80 whitespace-normal break-words"><p className="font-medium">{serviceName(service)}</p><p className="mt-1 text-xs text-muted-foreground">{serviceCode(service)} · Version {service.version}</p></TableCell><TableCell className="whitespace-normal"><p>{service.default_duration_minutes} minutes</p>{!validDuration(service.default_duration_minutes) && <p className="mt-1 text-xs text-muted-foreground">Historical duration; choose a supported value when editing.</p>}</TableCell><TableCell><Badge variant="secondary">{service.is_active ? 'Active' : 'Retired'}</Badge></TableCell><TableCell>{canManage ? <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onSelect({ action: 'metadata', service })} aria-label={`Edit details for ${serviceName(service)}`}>Edit details</Button><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onSelect({ action: service.is_active ? 'retire' : 'reactivate', service })} aria-label={`${service.is_active ? 'Retire' : 'Reactivate'} ${serviceName(service)}`}>{service.is_active ? 'Retire' : 'Reactivate'}</Button></div> : <span className="text-xs text-muted-foreground">View only</span>}</TableCell></TableRow>)}</TableBody></Table></div>;
}
function Unavailable({ onRetry }) { return <PageShell><PageState variant="error" title="Bookable service administration unavailable" description="Current appointment view authority, demographics access and the Appointments feature are required. Protected service content and local review copies are hidden." action={onRetry} /></PageShell>; }
function Directory({ access, onDenied }) {
  const client = useQueryClient();
  const [paging, setPaging] = useState({ search: '', status: '', cursors: [null], page: 0 });
  const [selection, setSelection] = useState(null), [open, setOpen] = useState(false), [finishing, setFinishing] = useState(false), [error, setError] = useState(null);
  const params = { limit: 25, ...(paging.search ? { search: paging.search } : {}), ...(paging.status !== '' ? { is_active: paging.status === 'active' } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const query = useQuery({ queryKey: serviceKeys.page(access.scope, params), queryFn: ({ signal }) => serviceApi.list(params, { signal }), enabled: access.canRead, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true });
  const sourceToken = useMemo(() => ({ data: query.data, error: query.error, updatedAt: query.dataUpdatedAt }), [query.data, query.error, query.dataUpdatedAt]);
  const refresh = () => Promise.all([
    client.invalidateQueries({ queryKey: serviceKeys.all(access.scope) }, { throwOnError: true }),
    client.invalidateQueries({ queryKey: ['scheduling', 'services'] }),
    client.invalidateQueries({ predicate: row => row.queryKey[0] === 'appointments' && ['types', 'availableSlots', 'scheduleSlots'].includes(row.queryKey[1]) }),
  ]);
  const controller = useBookableServiceCommand(access.scope, access.canWrite, onDenied, refresh);
  const barrier = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot);
  const blocked = barrier.unavailable || barrier.entries.length > 0;
  const denied = query.error?.status === 403; useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  if (denied) return <Unavailable />;
  const select = value => { if (controller.locked || blocked || !access.canWrite) return; setSelection(value); setOpen(true); setError(null); };
  const next = () => { const cursor = query.data?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); };
  const done = async () => { setFinishing(true); setError(null); try { await refresh(); controller.reset(); setSelection(null); setOpen(false); } catch { setError('The directory could not be refreshed. The original receipt remains confirmed; refresh before another change.'); } finally { setFinishing(false); } };
  const rowDisabled = controller.locked || blocked || query.isFetching || query.isError || !access.canWrite || finishing;
  return <PageShell><PageHeader title="Bookable services" description="Keep service names, default durations and booking availability clear while preserving booked care." actions={<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={query.isFetching || controller.busy} onClick={() => query.refetch()}>Refresh directory</Button>{controller.locked && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Review pending change</Button>}{access.canManage && <Button type="button" disabled={rowDisabled} onClick={() => select({ action: 'create' })}>Add service</Button>}</div>} />
    <div className="grid min-w-0 gap-6 p-4 sm:p-6"><DirectoryFilters state={paging} onChange={filters => setPaging({ ...filters, cursors: [null], page: 0 })} disabled={controller.busy} />
      {!access.canWrite && <Alert><AlertTitle>Directory is read-only</AlertTitle><AlertDescription>Browsing remains available. Changes require appointment management authority, network access and current server-confirmed credentials.</AlertDescription></Alert>}
      {blocked && !controller.unknown && <Alert><AlertTitle>A previous change needs review</AlertTitle><AlertDescription>Resolve the existing recovery notice before submitting a new service change. A directory refresh cannot confirm that earlier change.</AlertDescription></Alert>}
      {blocked && !controller.locked && access.canManage && <ServiceReloadRecovery {...{ access, onDenied }} />}
      {error && <p role="alert">{error}</p>}
      {query.isLoading ? <PageState variant="loading" title="Loading bookable services" fullHeight={false} /> : query.isError ? <PageState variant="error" title="Bookable services could not be loaded" description="Cached services are hidden until a current request succeeds." action={() => query.refetch()} fullHeight={false} /> : query.data?.data.length ? <DirectoryTable rows={query.data.data} onSelect={select} disabled={rowDisabled} canManage={access.canManage} /> : <PageState variant="empty" title="No services on this page" description="Change the search or status filter to browse other services." fullHeight={false} />}
      <DirectoryPagination page={paging.page} hasNext={!query.isError && query.data?.page.has_next} busy={query.isFetching || controller.busy} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={next} />
      <aside className="grid gap-2 rounded-xl border bg-muted/20 p-4"><h2 className="font-medium">Keep booked care intact</h2><p className="text-sm text-muted-foreground">Names and default durations can be corrected. Retirement stops new bookings and may be blocked by active future-generating templates. Existing appointments keep their booked times and are not cancelled. Codes remain permanent; deletion is unavailable here.</p></aside>
    </div>
    {selection && <ServiceChangeDialog key={`${selection.action}:${selection.service?.id || 'new'}`} {...{ selection, open, access, controller, onDenied }} onClose={() => { if (!controller.busy && !finishing) setOpen(false); }} onDone={done} finishing={finishing} sourceToken={sourceToken} />}
  </PageShell>;
}
function AuthorizedDirectory({ access }) {
  const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0); const onDenied = useCallback(() => setDenied(true), []);
  return denied ? <Unavailable onRetry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <Directory key={generation} access={access} onDenied={onDenied} />;
}
export default function BookableServiceDirectoryPage() {
  usePageMeta({ title: 'Bookable services', breadcrumbs: [{ label: 'Schedule', path: '/appointments' }, { label: 'Services', path: '/appointments/services' }] });
  const access = useBookableServiceAccess();
  return access.canRead ? <AuthorizedDirectory key={access.scope} access={access} /> : <Unavailable />;
}
