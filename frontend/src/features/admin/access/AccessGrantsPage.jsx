import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { userHasCapability } from '@/shared/lib/access';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RevokeAccessGrantDialog } from './RevokeAccessGrantDialog';
import { ACCESS_CAPABILITY, useAccessGrants } from './useAdminAccess';

const LABELS = { permission_assignment: 'Permission assignment', delegation: 'Delegation', authority_appointment: 'Authority appointment' };
function date(value) { return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'No end date'; }
function GrantsTable({ rows, onSelect, busy }) {
  return <div className="overflow-x-auto rounded-xl border bg-card"><Table>
    <TableHeader><TableRow><TableHead>Staff member</TableHead><TableHead>Authority</TableHead><TableHead>Effective dates</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
    <TableBody>{rows.map((grant) => <TableRow key={`${grant.kind}:${grant.id}`}>
      <TableCell className="font-medium">{grant.display_name}</TableCell>
      <TableCell><p className="text-sm">{LABELS[grant.kind]}</p><p className="mt-1 max-w-72 break-words font-mono text-xs text-muted-foreground">{grant.permission_code || grant.position_title}</p><p className="mt-1 text-xs text-muted-foreground">{grant.scope_type === 'facility' ? 'Facility scope' : 'Organization unit scope'}</p></TableCell>
      <TableCell className="text-xs"><p>From {date(grant.starts_at)}</p><p className="mt-1 text-muted-foreground">{grant.ends_at ? `Until ${date(grant.ends_at)}` : 'No end date'}</p></TableCell>
      <TableCell><Badge variant="secondary">{grant.status === 'active' && Date.parse(grant.starts_at) > Date.now() ? 'Scheduled' : grant.status}</Badge>{grant.reconciliation_required && <p className="mt-2 max-w-48 text-xs text-muted-foreground">Historical copied access remains until reviewed</p>}</TableCell>
      <TableCell><Button type="button" size="sm" variant="outline" disabled={busy || (grant.status === 'revoked' && !grant.reconciliation_required)} onClick={() => onSelect(grant)} aria-label={`Revoke ${LABELS[grant.kind].toLowerCase()} for ${grant.display_name}`}>Revoke</Button></TableCell>
    </TableRow>)}</TableBody>
  </Table></div>;
}
export default function AccessGrantsPage() {
  usePageMeta({ title: 'Access grants', breadcrumbs: [{ label: 'Admin', path: '/admin/organization' }, { label: 'Access grants', path: '/admin/access-grants' }] });
  const { user, login, reauthenticate } = useAuth();
  const [pagination, setPagination] = useState({ kind: '', cursors: [null], page: 0 });
  const [selected, setSelected] = useState(null);
  const enabled = isRustV2ApiMode() && userHasCapability(user, ACCESS_CAPABILITY);
  const query = useAccessGrants({ cursor: pagination.cursors[pagination.page], kind: pagination.kind, enabled });
  const rows = query.data?.data || [];
  const next = () => { const cursor = query.data?.page?.next_cursor; if (cursor) setPagination((current) => ({ ...current, cursors: [...current.cursors.slice(0, current.page + 1), cursor], page: current.page + 1 })); };
  if (!enabled) return <PageShell><PageState variant="error" title="Access administration unavailable" description={isRustV2ApiMode() ? 'Your account needs permission to manage authority grants.' : 'This access workflow is available with the Rust backend.'} /></PageShell>;
  return <PageShell><PageHeader title="Access grants" description="Review temporary permissions, delegated authority and appointments. Revoke grants while retaining their history and independently assigned access." actions={<Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh grants</Button>} />
    <div className="grid min-w-0 gap-5 p-4 sm:p-6">
      <div className="grid max-w-xs gap-2"><Label htmlFor="access-grant-kind">Grant type</Label><Select value={pagination.kind || 'all'} onValueChange={(kind) => setPagination({ kind: kind === 'all' ? '' : kind, cursors: [null], page: 0 })}><SelectTrigger id="access-grant-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All grants</SelectItem>{Object.entries(LABELS).map(([kind,label]) => <SelectItem key={kind} value={kind}>{label}</SelectItem>)}</SelectContent></Select></div>
      {query.isLoading ? <PageState variant="loading" title="Loading access grants" fullHeight={false} /> : query.isError ? <PageState variant="error" title="Access grants could not be loaded" description="Refresh before making changes. Previously loaded grants are hidden until the request succeeds." action={() => query.refetch()} fullHeight={false} /> : rows.length ? <GrantsTable rows={rows} onSelect={setSelected} busy={query.isFetching} /> : <PageState variant="empty" title="No access grants on this page" fullHeight={false} />}
      <nav aria-label="Access grant pages" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Page {pagination.page + 1} · Up to 25 grants</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={query.isFetching || pagination.page === 0} onClick={() => setPagination((current) => ({ ...current, page: current.page - 1 }))}>Previous</Button><Button type="button" variant="outline" disabled={query.isFetching || query.isError || !query.data?.page?.has_next} onClick={next}>Next</Button></div></nav>
    </div>
    {selected && <RevokeAccessGrantDialog key={`${selected.kind}:${selected.id}:${user.id}:${user.facilityCode}:${user.accessContext?.active_profile}`} grant={selected} user={user} reauthenticate={reauthenticate || login} onClose={() => setSelected(null)} onRefresh={() => query.refetch()} />}
  </PageShell>;
}
