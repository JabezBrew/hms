import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageState } from '@/shared/components/page/PageState';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/shared/components/boardui/Table';
import { normalizeSearch } from '../model';
export function CatalogPagination({ page, hasNext, busy, onPrevious, onNext, label }) {
  return <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3"><Button type="button" variant="outline" disabled={busy || page === 0} onClick={onPrevious}>Previous page</Button><span className="text-sm text-muted-foreground">Page {page + 1}</span><Button type="button" variant="outline" disabled={busy || !hasNext} onClick={onNext}>Next page</Button></nav>;
}
export function CatalogFilters({ kind, paging, onApply, disabled }) {
  const [fields, setFields] = useState(() => ({ search: paging.search, category: paging.category || '', status: paging.status, defaults: paging.defaults, modified: paging.modified })), [error, setError] = useState(null);
  const change = (key, value) => setFields(old => ({ ...old, [key]: value }));
  const submit = event => { event.preventDefault(); try { onApply({ ...fields, search: normalizeSearch(fields.search), category: kind === 'test' ? normalizeSearch(fields.category) : '' }); setError(null); } catch (failure) { setError(failure.message); } };
  return <form onSubmit={submit} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-3">
    <div className="grid gap-1.5"><Label htmlFor="lab-admin-search">Code or name</Label><Input id="lab-admin-search" value={fields.search} onChange={event => change('search', event.target.value)} /></div>
    {kind === 'test' && <div className="grid gap-1.5"><Label htmlFor="lab-admin-category">Category</Label><Input id="lab-admin-category" value={fields.category} onChange={event => change('category', event.target.value)} /></div>}
    {[['status', 'Availability', [['', 'All states'], ['active', 'Active'], ['inactive', 'Inactive']]], ['defaults', 'System default', [['', 'All definitions'], ['yes', 'System defaults'], ['no', 'Other definitions']]], ['modified', 'Facility modified', [['', 'All definitions'], ['yes', 'Marked modified'], ['no', 'Not marked modified']]]].map(([key, label, options]) => <div key={key} className="grid gap-1.5"><Label htmlFor={`lab-admin-${key}`}>{label}</Label><select id={`lab-admin-${key}`} className="h-10 rounded-md border bg-background px-3 text-sm" value={fields[key]} onChange={event => change(key, event.target.value)}>{options.map(([value, copy]) => <option key={value} value={value}>{copy}</option>)}</select></div>)}
    <Button type="submit" variant="outline" disabled={disabled} className="self-end">Search definitions</Button>{error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
  </form>;
}
export function CatalogDirectoryTable({ kind, rows, onView }) {
  return <Table aria-label={kind === 'test' ? 'Laboratory test definitions' : 'Laboratory panel definitions'} selectionMode="none"><TableHeader><TableColumn id="definition" isRowHeader>Definition</TableColumn><TableColumn id="state">Availability</TableColumn><TableColumn id="actions"><span className="sr-only">Actions</span></TableColumn></TableHeader><TableBody items={rows}>{row => <TableRow id={row.id} textValue={row.name || row.code}><TableCell className="min-w-40 max-w-80 whitespace-normal [overflow-wrap:anywhere]"><p className="font-medium">{row.name}</p><p className="mt-1 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{row.code} · Revision {row.version}</p></TableCell><TableCell><Badge variant="secondary">{row.is_active ? 'Active' : 'Inactive'}</Badge></TableCell><TableCell><Button type="button" size="sm" variant="outline" onClick={() => onView(row.id)} aria-label={`Review ${kind} definition ${row.name}`}>View details</Button></TableCell></TableRow>}</TableBody></Table>;
}
export function CatalogDirectory({ kind, query, paging, setPaging, onView }) {
  const busy = query.isFetching;
  const apply = filters => setPaging({ ...filters, cursors: [null], page: 0 });
  return <section className="grid min-w-0 gap-4"><CatalogFilters key={kind} {...{ kind, paging }} onApply={apply} disabled={busy} />{busy ? <PageState variant="loading" title="Confirming catalog definitions" fullHeight={false} /> : !query.current ? <PageState variant="error" title="Catalog definitions unavailable" description="A current authorized response is required." action={() => query.refetch()} fullHeight={false} /> : query.value.data.length === 0 ? <PageState variant="empty" title="No definitions on this page" fullHeight={false} /> : <CatalogDirectoryTable kind={kind} rows={query.value.data} onView={onView} />}
    <CatalogPagination label="Catalog directory pages" page={paging.page} hasNext={query.current && query.value.page.has_next} busy={busy || !query.current} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={() => { const cursor = query.value?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); }} />
  </section>;
}
