import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounce } from '@/hooks/use-debounce';
import { standingApi } from './api';
import { standingKeys } from './hooks';
export function StandingChoicePicker({ kind, label, value, excludedIds = [], onSelect, disabled = false }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState({ text: '', nonce: crypto.randomUUID(), cursor: null });
  const debounced = useDebounce(search, 200);
  const query = useQuery({
    queryKey: standingKeys.choices(kind, debounced.nonce, debounced.cursor),
    queryFn: ({ signal }) => standingApi.choices(kind, { limit: 25, ...(debounced.text ? { search: debounced.text } : {}), ...(debounced.cursor ? { cursor: debounced.cursor } : {}) }, { signal }),
    enabled: open, retry: false, staleTime: 0, gcTime: 0,
  });
  const excluded = new Set(excludedIds);
  const changing = search.nonce !== debounced.nonce;
  const choices = (query.data?.data || []).filter((item) => !excluded.has(item.id) && !(kind === 'items' && (item.controlled || item.is_controlled)));
  return <section className="grid gap-3 rounded-xl border p-3" aria-label={label}>
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-words text-sm">{label}: <span className="font-medium">{value?.name || 'Choose a facility option'}</span></p><Button type="button" variant="outline" size="sm" disabled={disabled} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? 'Close choices' : 'Choose'}</Button></div>
    {open && <div id={id} className="grid gap-3"><Label htmlFor={`${id}-search`}>Search {label.toLowerCase()}</Label><Input id={`${id}-search`} maxLength={160} value={search.text} disabled={disabled} onChange={(event) => setSearch({ text: event.target.value, nonce: crypto.randomUUID(), cursor: null })} />
      {query.isError ? <p role="alert" className="text-sm text-destructive">Choices are unavailable. <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>Retry choices</Button></p> : query.isFetching || changing ? <p role="status" className="text-sm text-muted-foreground">Loading choices…</p> : <ul className="grid max-h-56 gap-2 overflow-y-auto" aria-label={`${label} choices`}>{choices.map((item) => <li key={item.id}><Button type="button" variant="outline" disabled={disabled} className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => { onSelect(item); setOpen(false); }}><span>{item.name}<span className="mt-1 block text-xs text-muted-foreground">{item.code}{item.unit ? ` · ${item.unit}` : ''}</span></span></Button></li>)}</ul>}
      {!query.isFetching && !query.isError && !changing && !choices.length && <p className="text-sm text-muted-foreground">No eligible choices on this page.</p>}
      {query.data?.page?.has_next && !query.isError && <Button type="button" variant="outline" disabled={disabled || query.isFetching || changing} onClick={() => setSearch((current) => ({ ...current, cursor: query.data.page.next_cursor, nonce: crypto.randomUUID() }))}>Next choices</Button>}
      {search.cursor && <Button type="button" variant="ghost" disabled={disabled} onClick={() => setSearch((current) => ({ ...current, cursor: null, nonce: crypto.randomUUID() }))}>First choices</Button>}
    </div>}
  </section>;
}
