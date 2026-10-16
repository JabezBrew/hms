import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@/hooks/use-debounce';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dispensingLocationKeys, getDispensingLocations } from '../api/dispensingLocations';
function LocationChoices({ onSelect, disabled }) {
  const id = useId();
  const [search, setSearch] = useState(() => ({ text: '', nonce: crypto.randomUUID(), cursor: null, previous: [] }));
  const debounced = useDebounce(search, 200);
  const query = useQuery({ queryKey: dispensingLocationKeys.search(debounced.nonce, debounced.cursor), queryFn: ({ signal }) => getDispensingLocations({ search: debounced.text, cursor: debounced.cursor, signal }), retry: false, staleTime: 0, gcTime: 0 });
  const changing = debounced.nonce !== search.nonce;
  const move = (cursor, previous) => setSearch((current) => ({ ...current, cursor, previous, nonce: crypto.randomUUID() }));
  return <div className="grid gap-3"><Label htmlFor={id}>Search dispensing locations</Label><Input id={id} value={search.text} maxLength={160} disabled={disabled} placeholder="Location name or code" onChange={(event) => setSearch({ text: event.target.value, nonce: crypto.randomUUID(), cursor: null, previous: [] })} />
    {query.isError ? <Alert variant="destructive"><AlertDescription>Locations could not be loaded. Choose a location after a successful refresh.<Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>Retry locations</Button></AlertDescription></Alert> : query.isFetching || changing ? <p role="status" className="text-sm text-muted-foreground">Loading dispensing locations…</p> : <ul aria-label="Dispensing location choices" className="grid max-h-48 gap-2 overflow-y-auto">{query.data?.data.map((location) => <li key={location.id}><Button type="button" variant="outline" className="h-auto w-full justify-start whitespace-normal text-left" disabled={disabled} onClick={() => onSelect(location)}><span><span className="block">{location.name}</span><span className="mt-1 block text-xs text-muted-foreground">{location.code}</span></span></Button></li>)}</ul>}
    {!query.isError && !query.isFetching && !changing && query.data?.data.length === 0 && <p className="text-sm text-muted-foreground">No active locations match this search.</p>}
    <nav aria-label="Dispensing location pages" className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={disabled || changing || query.isFetching || !search.previous.length} onClick={() => move(search.previous.at(-1), search.previous.slice(0, -1))}>Previous locations</Button><Button type="button" size="sm" variant="outline" disabled={disabled || changing || query.isFetching || query.isError || !query.data?.page.has_next} onClick={() => move(query.data.page.next_cursor, [...search.previous, search.cursor])}>Next locations</Button></nav>
  </div>;
}
export function DispensingLocationPicker({ value, onSelect, disabled }) {
  const [expanded, setExpanded] = useState(!value);
  return <section aria-label="Dispensing location" className="grid gap-3 rounded-xl border p-4"><h3 className="text-sm font-medium">Dispensing location</h3>
    {value && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{value.name} · {value.code}</p><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setExpanded(!expanded)}>{expanded ? 'Close location choices' : 'Change location'}</Button></div>}
    {expanded && <LocationChoices disabled={disabled} onSelect={(location) => { onSelect(location); setExpanded(false); }} />}
    <p className="text-xs text-muted-foreground">Choose the location issuing this stock. No location is selected automatically; availability is checked when supply is recorded.</p>
  </section>;
}
