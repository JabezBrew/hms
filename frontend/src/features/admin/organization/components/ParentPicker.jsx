import { useLayoutEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { organizationApi } from '../api';
import { organizationKeys } from '../keys';
import { DirectoryPagination } from './DirectoryControls';
export function ParentPicker({ scope, enabled, selected, onSelect, disabled, onDenied }) {
  const [paging, setPaging] = useState({ cursors: [null], page: 0 });
  const params = { limit: 25, is_active: true, ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const query = useQuery({ queryKey: organizationKeys.page(scope, { ...params, purpose: 'parent-selection' }), queryFn: ({ signal }) => organizationApi.list(params, { signal }), enabled, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  const denied = query.error?.status === 403;
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  const next = () => { const cursor = query.data?.page.next_cursor; if (cursor) setPaging(old => ({ cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); };
  return <fieldset className="grid gap-3 rounded-xl border p-4" disabled={disabled}><legend className="px-1 text-sm font-medium">Parent unit</legend><p className="text-sm text-muted-foreground">Choose no parent or one exact active unit. Parent choice is permanent after creation.</p>
    <label className="flex items-start gap-3"><input type="radio" name="organization-parent" checked={selected?.choice === 'none'} onChange={() => onSelect({ choice: 'none' })} /><span>No parent unit</span></label>
    {selected?.choice === 'unit' && <p className="break-words text-sm">Selected parent: {selected.unit.name} ({selected.unit.code})</p>}
    {query.isError ? <p role="alert">Parent units could not be confirmed. Refresh before selecting.</p> : query.isFetching ? <p role="status">Loading current parent choices…</p> : (query.data?.data || []).map(unit => <label key={unit.id} className="flex items-start gap-3 rounded-lg border p-3"><input type="radio" name="organization-parent" checked={selected?.choice === 'unit' && selected.unit.id === unit.id} onChange={() => onSelect({ choice: 'unit', unit })} /><span className="min-w-0 break-words">{unit.name}<span className="block text-xs text-muted-foreground">{unit.code}</span></span></label>)}
    <DirectoryPagination page={paging.page} hasNext={!query.isError && query.data?.page.has_next} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={next} busy={disabled || query.isFetching} label="Parent unit pages" />
  </fieldset>;
}
