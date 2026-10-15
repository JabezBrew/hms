import { useId, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounce } from '@/hooks/use-debounce';
import { getMedicationCatalog, medicationCatalogKeys } from '../api/medicationCatalog';

function CatalogResults({ onSelect }) {
  const inputId = useId();
  // Cache keys contain an opaque request nonce, never the entered clinical text.
  const [search, setSearch] = useState(() => ({ text: '', nonce: crypto.randomUUID() }));
  const debounced = useDebounce(search, 250);
  const query = useInfiniteQuery({
    queryKey: medicationCatalogKeys.search(debounced.nonce),
    queryFn: ({ pageParam, signal }) => getMedicationCatalog({ search: debounced.text, cursor: pageParam, signal }),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.page?.has_next ? page.page.next_cursor : undefined,
    retry: false,
    staleTime: 30_000,
    gcTime: 0,
  });
  const searching = search.nonce !== debounced.nonce;
  const items = query.data?.pages.flatMap((page) => page.data || []) || [];

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor={inputId}>Search facility medication catalog</Label>
      <Input
        id={inputId}
        maxLength={160}
        placeholder="Medication name or catalog code"
        value={search.text}
        onChange={(event) => setSearch({ text: event.target.value, nonce: crypto.randomUUID() })}
      />
      <div aria-live="polite" aria-busy={query.isFetching || searching}>
        {query.isPending || searching ? <p className="text-sm text-muted-foreground">Loading medication choices…</p> : null}
        {query.isError ? (
          <Alert variant="destructive">
            <AlertDescription>
              Medication choices could not be loaded. You can retry or continue without a stock link.
              <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>Retry catalog</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!query.isPending && !query.isError && !searching && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching facility medications. You can prescribe without linking stock.</p>
        ) : null}
      </div>
      {!searching && items.length > 0 ? (
        <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto" aria-label="Facility medication choices">
          {items.map((item) => (
            <li key={item.id}>
              <Button type="button" variant="outline" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => onSelect(item)}>
                <span className="flex min-w-0 flex-col gap-1">
                  <span>{item.name}</span>
                  <span className="text-xs text-muted-foreground">{item.code} · {item.unit}</span>
                  {item.controlled ? <Badge variant="secondary">Controlled medication</Badge> : null}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {query.hasNextPage && !searching ? (
        <Button type="button" variant="outline" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading more…' : 'Load more medication choices'}
        </Button>
      ) : null}
    </div>
  );
}

export function MedicationStockPicker({ itemId, itemName, onSelect }) {
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-label="Prescription stock link">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Facility stock link <span className="text-muted-foreground">(optional)</span></p>
        <Button type="button" variant="outline" size="sm" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Close catalog' : itemId ? 'Change stock link' : 'Choose facility medication'}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Choose the exact product for pharmacy fulfillment. Check the strength and dose separately. Linking does not reserve stock.</p>
      {itemId ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">Linked: {itemName}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onSelect(null)}>Remove stock link</Button>
        </div>
      ) : null}
      <div id={regionId}>
        {expanded ? <CatalogResults onSelect={(item) => { onSelect(item); setExpanded(false); }} /> : null}
      </div>
    </section>
  );
}
