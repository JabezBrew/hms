import { useLayoutEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { v2Api } from '@/lib/api/v2/client';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { validId } from '../catalog/model';
import { selectedItem } from './model';

// These operational reads return only active local sources. Administrative
// history/status lists must never be substituted for stock-source eligibility.
export function TransferSourcePicker({ kind, label, scope, selectedId, onSelect, disabled, onUnavailable }) {
  const [search, setSearch] = useState('');
  const [paging, setPaging] = useState({ search: '', cursors: [null], page: 0 });
  const query = { limit: 25, ...(paging.search ? { search: paging.search } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const read = useQuery({
    queryKey: ['inventory', 'transfer-sources', scope, kind, hashQueryValue(JSON.stringify(query))],
    queryFn: async ({ signal }) => {
      const result = await v2Api[kind === 'items' ? 'getInventoryItems' : 'getStorageLocations']({ query, signal });
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!Array.isArray(result?.data) || result.data.some(row => !validId(row?.id) || typeof row.name !== 'string' || typeof row.code !== 'string' || (Object.hasOwn(row, 'is_active') && !row.is_active))) throw new Error('Current active sources could not be verified.');
      if (kind === 'items') result.data.forEach(row => selectedItem(row));
      return result;
    },
    retry: false, staleTime: 0, gcTime: 0,
  });
  const next = () => { const cursor = read.data?.page?.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); };
  const inputId = `transfer-${label.toLowerCase().replaceAll(' ', '-')}`;
  return <fieldset className="flex min-w-0 flex-col gap-3" disabled={disabled}>
    <legend className="mb-2 font-medium">{label}</legend>
    <Label htmlFor={inputId}>Find {label.toLowerCase()}</Label>
    <div className="flex gap-2"><Input id={inputId} value={search} onChange={event => setSearch(event.target.value)} /><Button type="button" variant="outline" onClick={() => setPaging({ search, cursors: [null], page: 0 })}>Search {label.toLowerCase()}</Button></div>
    {read.isError ? <div role="alert" className="flex flex-col gap-2"><p>Current {label.toLowerCase()} could not be loaded. Previous choices are hidden.</p><Button type="button" variant="outline" onClick={() => { onUnavailable(); read.refetch(); }}>Reload {label.toLowerCase()}</Button></div> : read.isFetching ? <p role="status">Loading {label.toLowerCase()}…</p> : <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">{read.data?.data.map(row => <Button type="button" key={row.id} variant={selectedId === row.id ? 'secondary' : 'outline'} aria-pressed={selectedId === row.id} className="h-auto justify-start whitespace-normal text-left" onClick={() => onSelect(row)}>{row.name} ({row.code})</Button>)}{read.data?.data.length === 0 && <p>No active {label.toLowerCase()} match this search.</p>}</div>}
    <nav aria-label={`${label} pages`} className="flex min-w-0 flex-wrap items-center gap-2"><Button type="button" variant="outline" aria-label={`Previous ${label.toLowerCase()}`} className="shrink-0" disabled={!paging.page || read.isFetching} onClick={() => setPaging(old => ({ ...old, page: old.page - 1 }))}>Previous</Button><span className="shrink-0 whitespace-nowrap text-sm">Page {paging.page + 1}</span><Button type="button" variant="outline" aria-label={`Next ${label.toLowerCase()}`} className="shrink-0" disabled={read.isError || read.isFetching || !read.data?.page?.has_next} onClick={next}>Next</Button></nav>
    {read.isError && <TransferReadFailure onUnavailable={onUnavailable} />}
  </fieldset>;
}

// A current failed read drops any copied choice even if Query retains old data.
function TransferReadFailure({ onUnavailable }) {
  // The tiny error child mounts once per failed read, outside render side effects.
  useLayoutEffect(() => { onUnavailable(); }, [onUnavailable]);
  return null;
}
