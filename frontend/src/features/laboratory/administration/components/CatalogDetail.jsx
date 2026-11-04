import { useLayoutEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageState } from '@/shared/components/page/PageState';
import { laboratoryCatalogApi } from '../api';
import { catalogKeys } from '../keys';
import { orderingCopy } from '../model';
import { useCatalogRead } from '../useCatalogRead';
import { CatalogPagination } from './CatalogDirectory';
export const RawValue = ({ value }) => <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value === null ? 'Not recorded' : value === '' ? 'Blank text' : value}</span>;
export function CatalogValues({ subject }) {
  const row = subject.definition;
  const values = [['Code', row.code], ['Name', row.name], ['Revision', row.version], ...(subject.kind === 'test' ? [['Category', row.category], ['Specimen', row.specimen_type], ['Result unit', row.result_unit]] : [['Configured tests', row.test_count]]), ['System default', row.is_system_default ? 'Yes' : 'No'], ['Facility modified', row.is_facility_modified ? 'Yes' : 'No']];
  return <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">{values.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted-foreground">{label}</dt><dd><RawValue value={value} /></dd></div>)}</dl>;
}
export function CatalogHistory({ rows }) {
  return rows.length === 0 ? <PageState variant="empty" title="No availability records on this page" fullHeight={false} /> : <ol aria-label="Availability recording history" className="grid min-w-0 gap-3">{rows.map(row => <li key={row.id} className="grid gap-2 rounded-xl border bg-card p-4"><p className="font-medium">{row.changed ? `${row.before_is_active ? 'Active' : 'Inactive'} → ${row.after_is_active ? 'Active' : 'Inactive'}` : `Availability unchanged · ${row.after_is_active ? 'Active' : 'Inactive'}`}</p><p className="font-mono text-xs [overflow-wrap:anywhere]">Revision {row.before_version} → {row.after_version} · {row.recorded_at}</p></li>)}</ol>;
}
export function CatalogDetail({ kind, id, access, onDenied, onAction, onSourceChange, disabled }) {
  const [paging, setPaging] = useState({ cursors: [null], page: 0 });
  const params = { limit: 25, ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const detail = useCatalogRead({ access, queryKey: catalogKeys.detail(access.scope, kind, id), read: signal => laboratoryCatalogApi.get(kind, id, { signal }), onDenied });
  const history = useCatalogRead({ access, queryKey: catalogKeys.history(access.scope, kind, id, params), read: signal => laboratoryCatalogApi.history(kind, id, params, { signal }), onDenied, enabled: detail.current });
  useLayoutEffect(() => { onSourceChange({ data: detail.data, error: detail.error, fetching: detail.isFetching }); }, [detail.data, detail.error, detail.isFetching, onSourceChange]);
  if (detail.isFetching || !access.readReady) return <PageState variant="loading" title="Confirming current definition" fullHeight={false} />;
  if (!detail.current) return <PageState variant="error" title="Definition unavailable" description="The exact definition may be unavailable or access may have changed. Earlier values stay hidden until a current request succeeds." action={() => detail.refetch()} fullHeight={false} />;
  const subject = detail.value, row = subject.definition;
  return <div className="grid min-w-0 gap-6"><section className="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:p-6"><div className="flex min-w-0 flex-wrap justify-between gap-3"><h2 className="font-heading text-xl [overflow-wrap:anywhere]">{row.name}</h2><Badge variant="secondary">{row.is_active ? 'Active' : 'Inactive'}</Badge></div><CatalogValues subject={subject} /><p className="text-sm">{orderingCopy(subject.ordering)}</p>{subject.kind === 'panel' && <p className="text-xs text-muted-foreground">Configured test count includes unavailable retained members. Active panels also need every configured test to be available.</p>}<Button type="button" className="w-fit" variant="outline" disabled={disabled || detail.isFetching} onClick={() => onAction(subject)}>Review availability</Button><p className="text-xs text-muted-foreground">Changing availability affects new orders. Accepted orders and their results remain recorded. Definition text and panel membership cannot be edited here.</p></section>
    <section className="grid min-w-0 gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-lg">Availability history</h2><Button type="button" variant="outline" disabled={history.isFetching} onClick={() => history.refetch()}>Refresh history</Button></div><p className="text-sm text-muted-foreground">Availability commands only. Definition revisions may also change through separate maintenance; this history does not reconstruct those changes.</p>{history.isFetching ? <PageState variant="loading" title="Loading availability history" fullHeight={false} /> : !history.current ? <PageState variant="error" title="Availability history unavailable" action={() => history.refetch()} fullHeight={false} /> : <CatalogHistory rows={history.value.data} />}<CatalogPagination label="Availability history pages" page={paging.page} hasNext={history.current && history.value.page.has_next} busy={history.isFetching || !history.current} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={() => { const cursor = history.value?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); }} /></section>
  </div>;
}
