import { useLayoutEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
export function DirectoryFilters({ state, onChange, disabled, resetKey }) {
  const applied = typeof state.search === 'string' ? state.search : '';
  const [search, setSearch] = useState(applied), [error, setError] = useState(null);
  // External query navigation or an explicit reset replaces the draft. Ordinary
  // status/data rerenders keep an unsent edit and the same focused input node.
  useLayoutEffect(() => { setSearch(applied); setError(null); }, [applied, resetKey]);
  const submit = event => { event.preventDefault(); const value = search.trim(); if (new TextEncoder().encode(value).length > 160) { setError('Use a search of up to 160 UTF-8 bytes.'); return; } setError(null); setSearch(value); onChange({ ...state, search: value }); };
  return <form onSubmit={submit} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_auto]">
    <div className="grid min-w-0 gap-2 sm:col-span-2 lg:col-span-1"><Label htmlFor="categories-search" className="leading-normal">Find a category by name or code</Label><Input id="categories-search" value={search} onChange={event => setSearch(event.target.value)} disabled={disabled} autoComplete="off" /></div>
    <div className="grid min-w-0 gap-2"><Label htmlFor="categories-status">Status</Label><Select value={state.status || 'all'} onValueChange={status => onChange({ ...state, status: status === 'all' ? '' : status })} disabled={disabled}><SelectTrigger id="categories-status" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All categories</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="retired">Retired</SelectItem></SelectGroup></SelectContent></Select></div>
    <Button type="submit" variant="outline" className="w-full lg:w-auto" disabled={disabled}>Search categories</Button>{error && <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">{error}</p>}
  </form>;
}
export function CategoryPagination({ page, hasNext, onPrevious, onNext, busy, label = 'Category pages' }) {
  return <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Page {page + 1} · Up to 25 records</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={busy || page === 0} onClick={onPrevious}>Previous</Button><Button type="button" variant="outline" disabled={busy || !hasNext} onClick={onNext}>Next</Button></div></nav>;
}
