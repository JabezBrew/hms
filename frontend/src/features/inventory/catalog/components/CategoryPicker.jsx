import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inventoryCatalogApi } from '../api';
import { catalogKeys } from '../keys';
import { displayText } from '../model';
import { useCatalogRead } from '../useCatalogRead';
export function CategoryPicker({ access, selected, onSelect, onDenied, disabled }) {
  const id = useId(), [search, setSearch] = useState(''), [paging, setPaging] = useState({ search: '', cursors: [null], page: 0 }), [error, setError] = useState(null);
  const params = { limit: 25, ...(paging.search ? { search: paging.search } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const query = useCatalogRead({ access, queryKey: catalogKeys.categories(access.scope, params), read: signal => inventoryCatalogApi.categories(params, { signal }), onDenied });
  const confirmed = Boolean(selected?.lease?.isCurrent());
  const apply = () => { const value = search.trim(); if (new TextEncoder().encode(value).length > 160) { setError('Use a category search of up to 160 UTF-8 bytes.'); return; } setError(null); setPaging({ search: value, cursors: [null], page: 0 }); };
  return <fieldset disabled={disabled} className="grid min-w-0 gap-3 rounded-xl border p-4"><legend className="px-1 text-sm font-medium">Choose an exact category</legend>
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="grid gap-2"><Label htmlFor={id}>Search categories</Label><Input id={id} value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} /></div><Button type="button" variant="outline" className="sm:self-end" disabled={query.isFetching} onClick={apply}>Search categories</Button></div>
    {selected && <p className="break-words text-sm">Selected category: {displayText(selected.row.name)} ({displayText(selected.row.code)}){!confirmed && ' · Refresh and select from a current category page before review.'}</p>}
    {error && <p role="alert">{error}</p>}{query.isFetching ? <p role="status" className="text-sm">Loading categories…</p> : query.error || !query.current ? <div className="grid gap-2"><p role="alert" className="text-sm">Current categories are unavailable. A previous choice cannot be used until confirmed.</p><Button type="button" variant="outline" onClick={() => query.refetch()}>Refresh categories</Button></div> : query.value.data.length ? <ul className="grid gap-2">{query.value.data.map(row => <li key={row.id}><Button type="button" variant={selected?.row.id === row.id && confirmed ? 'secondary' : 'outline'} className="h-auto w-full justify-start whitespace-normal break-words text-left" onClick={() => onSelect({ row: Object.freeze(structuredClone(row)), response: query.response, lease: query.data.lease })}>{displayText(row.name)} ({displayText(row.code)})</Button></li>)}</ul> : <p className="text-sm text-muted-foreground">No categories on this page. Change the search to find an existing category.</p>}
    <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={query.isFetching || paging.page === 0} onClick={() => setPaging(old => ({ ...old, page: old.page - 1 }))}>Previous category page</Button><span className="text-xs text-muted-foreground">Category page {paging.page + 1}</span><Button type="button" variant="outline" disabled={query.isFetching || !query.current || !query.value?.page.has_next} onClick={() => { const cursor = query.value?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); }}>Next category page</Button></div>
  </fieldset>;
}
