import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inventoryCategoryApi } from '../api';
import { categoryKeys } from '../keys';
import { displayText } from '../model';
import { useCategoryRead } from '../useCategoryRead';
export function ParentPicker({ access, selected, onSelect, onDenied, onSourceChange, disabled, subjectId }) {
  const id = useId(), [search, setSearch] = useState(''), [paging, setPaging] = useState({ search: '', cursors: [null], page: 0 }), [error, setError] = useState(null);
  const source = useRef({ epoch: 0, available: false }), selectedDetail = useRef(null);
  const params = { limit: 25, is_active: true, ...(paging.search ? { search: paging.search } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const query = useCategoryRead({ access, queryKey: categoryKeys.parents(access.scope, params), read: signal => inventoryCategoryApi.list(params, { signal }), onDenied });
  const detail = useCategoryRead({ access, queryKey: categoryKeys.detail(access.scope, selected?.row.id ?? 'unselected'), read: signal => inventoryCategoryApi.get(selected.row.id, { signal }), onDenied, enabled: Boolean(selected) });
  const { current: pageCurrent, data: pageData, error: pageError, isFetching: pageFetching } = query;
  const { current: detailCurrent, value: currentDetail, data: detailData, error: detailError, isFetching: detailFetching } = detail;
  // A failed later candidate read revokes every earlier candidate observation.
  // Successful paging does not pretend that absence on this page means invalid.
  useLayoutEffect(() => {
    selectedDetail.current = detailCurrent && !detailFetching ? currentDetail.category : null;
    if (pageError || !access.readReady) { source.current.epoch++; source.current.available = false; }
    else source.current.available = pageCurrent && !pageFetching;
    onSourceChange();
  }, [pageData, pageError, pageFetching, pageCurrent, access.readReady, detailCurrent, currentDetail, detailData, detailError, detailFetching, onSourceChange]);
  useLayoutEffect(() => () => { source.current.epoch++; source.current.available = false; }, []);
  const choose = row => {
    const epoch = source.current.epoch, lease = query.data.lease;
    onSelect({ row: Object.freeze(structuredClone(row)), response: query.response, lease, epoch,
      isCurrent: () => source.current.epoch === epoch && source.current.available && lease.isCurrent() && selectedDetail.current?.id === row.id && selectedDetail.current.version === row.version && selectedDetail.current.is_active });
  };
  const apply = () => { const value = search.trim(); if (new TextEncoder().encode(value).length > 160) { setError('Use a parent search of up to 160 UTF-8 bytes.'); return; } setError(null); setPaging({ search: value, cursors: [null], page: 0 }); };
  const confirmed = Boolean(selected && selected.epoch === source.current.epoch && selected.lease.isCurrent() && query.current && !query.isFetching
    && detail.current && !detail.isFetching && detail.value.category.id === selected.row.id && detail.value.category.version === selected.row.version && detail.value.category.is_active);
  const candidates = query.value?.data.filter(row => row.id !== subjectId) ?? [];
  return <fieldset disabled={disabled} className="grid min-w-0 gap-3 rounded-xl border p-4"><legend className="px-1 text-sm font-medium">Choose an exact direct parent</legend>
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="grid min-w-0 gap-2"><Label htmlFor={id}>Search parent categories</Label><Input id={id} value={search} autoComplete="off" onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} /></div><Button type="button" variant="outline" className="sm:self-end" disabled={query.isFetching} onClick={apply}>Search parents</Button></div>
    {selected && <div className="grid min-w-0 gap-2 text-sm"><p className="[overflow-wrap:anywhere]">Selected parent: {displayText(selected.row.name)} ({displayText(selected.row.code)}) · Revision {selected.row.version}</p>{detail.isFetching ? <p role="status">Confirming exact selected parent…</p> : !confirmed || !detail.current || detail.value.category.version !== selected.row.version || !detail.value.category.is_active ? <p role="alert">Selected parent evidence is unavailable or changed. Refresh the candidate page and select its current revision.</p> : <p className="font-mono text-xs [overflow-wrap:anywhere]">Current exact parent: {detail.value.category.id}</p>}<Button type="button" variant="outline" disabled={detail.isFetching || !access.readReady} onClick={() => detail.refetch()}>Refresh selected parent</Button></div>}
    {error && <p role="alert">{error}</p>}{query.isFetching ? <p role="status">Loading parent categories…</p> : !query.current ? <div className="grid gap-2"><p role="alert">Current parent candidates are unavailable. An earlier selection cannot authorize a change.</p><Button type="button" variant="outline" onClick={() => query.refetch()}>Refresh parent categories</Button></div> : candidates.length ? <ul className="grid min-w-0 gap-2">{candidates.map(row => <li key={row.id} className="min-w-0"><Button type="button" variant={confirmed && selected.row.id === row.id ? 'secondary' : 'outline'} className="h-auto w-full justify-start whitespace-normal text-left [overflow-wrap:anywhere]" onClick={() => choose(row)}>{displayText(row.name)} ({displayText(row.code)}) · Revision {row.version}</Button></li>)}</ul> : <p className="text-sm text-muted-foreground">No eligible parent on this page. Search or browse another page.</p>}
    <nav aria-label="Parent category pages" className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" aria-label="Previous parent category page" disabled={query.isFetching || paging.page === 0} onClick={() => setPaging(old => ({ ...old, page: old.page - 1 }))}>Previous</Button><span className="text-xs text-muted-foreground">Parent page {paging.page + 1}</span><Button type="button" variant="outline" aria-label="Next parent category page" disabled={query.isFetching || !query.current || !query.value?.page.has_next} onClick={() => { const cursor = query.value?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); }}>Next</Button><Button type="button" variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh parents</Button></nav>
  </fieldset>;
}
