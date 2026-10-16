import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { userHasCapability } from '@/shared/lib/access';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useDebounce } from '@/hooks/use-debounce';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStandingTemplates } from './hooks';
import { StandingTemplateFormDialog } from './StandingTemplateFormDialog';
import { StandingTemplateDetailDialog } from './StandingTemplateDetailDialog';
import { StandingRequestReviewDialog } from './StandingRequestReviewDialog';
export default function StandingTemplatesPage() {
  usePageMeta({ title: 'Standing stock orders', breadcrumbs: [{ label: 'Inventory', path: '/inventory' }, { label: 'Standing orders', path: '/inventory/standing-orders' }] });
  const { user } = useAuth();
  const canManage = userHasCapability(user, 'inventory.manage');
  const [filters, setFilters] = useState({ search: '', status: '', due: false, cursor: null, previous: [] });
  const [modal, setModal] = useState(null);
  const search = useDebounce(filters.search, 250);
  const query = useStandingTemplates({ limit: 25, ...(search ? { search } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.due ? { due_only: true } : {}), ...(filters.cursor ? { cursor: filters.cursor } : {}) });
  const updating = query.isFetching || search !== filters.search;
  const changeFilters = (patch) => setFilters((current) => ({ ...current, ...patch, cursor: null, previous: [] }));
  const next = () => { if (query.data?.page?.next_cursor) setFilters((current) => ({ ...current, previous: [...current.previous, current.cursor], cursor: query.data.page.next_cursor })); };
  const previous = () => setFilters((current) => ({ ...current, cursor: current.previous.at(-1), previous: current.previous.slice(0, -1) }));
  const rows = query.data?.data || [];
  return <PageShell><PageHeader title="Standing stock orders" description="Configure recurring stock requests, review their due dates and generate each request explicitly. Stock moves only through the issue workflow." actions={<><Button type="button" variant="outline" disabled={updating} onClick={() => query.refetch()}>Refresh templates</Button>{canManage && <Button type="button" onClick={() => setModal({ kind: 'create' })}>New template</Button>}</>} />
    <div className="grid min-w-0 gap-5 p-4 sm:p-6"><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"><div className="grid gap-2"><Label htmlFor="standing-search">Find templates</Label><Input id="standing-search" maxLength={160} value={filters.search} onChange={(event) => changeFilters({ search: event.target.value })} /></div><div className="grid gap-2"><Label htmlFor="standing-status">Status</Label><Select value={filters.status || 'all'} onValueChange={(value) => changeFilters({ status: value === 'all' ? '' : value })}><SelectTrigger id="standing-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{['active', 'paused', 'cancelled'].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div><div className="flex items-center gap-2 self-end py-2"><Checkbox id="standing-due" checked={filters.due} onCheckedChange={(due) => changeFilters({ due: due === true })} /><Label htmlFor="standing-due">Due now (UTC)</Label></div></div>
      {query.isError ? <PageState variant="error" title="Standing templates unavailable" description="Saved standing orders could not be loaded. Retry when your connection is available; older summaries cannot be used to generate item requests." action={() => query.refetch()} fullHeight={false} /> : query.isLoading || updating ? <PageState variant="loading" title="Loading standing templates" fullHeight={false} /> : !rows.length ? <PageState variant="empty" title="No matching standing templates" description="Create a template with exact locations, inventory items and quantities to begin." fullHeight={false} /> : <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow><TableHead>Template</TableHead><TableHead>Locations</TableHead><TableHead>Frequency</TableHead><TableHead>Next due (UTC)</TableHead><TableHead>Status</TableHead><TableHead>Items</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{rows.map((template) => <TableRow key={template.id}><TableCell className="font-medium">{template.name}</TableCell><TableCell><p>{template.requesting_location_name}</p><p className="text-xs text-muted-foreground">from {template.fulfilling_location_name}</p></TableCell><TableCell>{template.frequency === 'biweekly' ? 'Every two weeks' : template.frequency}</TableCell><TableCell className="font-mono text-xs">{template.next_run_on}</TableCell><TableCell>{template.status}</TableCell><TableCell>{template.line_count}</TableCell><TableCell><Button type="button" size="sm" variant="outline" onClick={() => setModal({ kind: 'detail', id: template.id })} aria-label={`Review ${template.name}`}>Review</Button></TableCell></TableRow>)}</TableBody></Table></div>}
      <nav aria-label="Standing template pages" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Page {filters.previous.length + 1} · Up to 25 templates</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={updating || !filters.previous.length} onClick={previous}>Previous</Button><Button type="button" variant="outline" disabled={updating || query.isError || !query.data?.page?.has_next} onClick={next}>Next</Button></div></nav>
    </div>
    {canManage && ['create', 'edit'].includes(modal?.kind) && <StandingTemplateFormDialog key={modal.template?.id || 'new'} template={modal.template} onClose={() => setModal(null)} />}
    {modal?.kind === 'detail' && <StandingTemplateDetailDialog id={modal.id} user={user} onClose={() => setModal(null)} onEdit={(template) => setModal({ kind: 'edit', template })} onReviewRequest={(id) => setModal({ kind: 'request', id })} />}
    {modal?.kind === 'request' && <StandingRequestReviewDialog id={modal.id} onClose={() => setModal(null)} />}
  </PageShell>;
}
