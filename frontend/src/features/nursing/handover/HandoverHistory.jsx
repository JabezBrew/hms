import { useLayoutEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { handoverApi } from './api';
import { handoverKeys } from './keys';
import { HandoverEvidence } from './HandoverEvidence';

export function HandoverHistory({ root, scope, patientId, open, onDenied }) {
  const [cursor, setCursor] = useState(null); const [previous, setPrevious] = useState([]); const [selected, setSelected] = useState(null);
  const query = useQuery({ queryKey: handoverKeys.history(scope, patientId, root.id, cursor), queryFn: ({ signal }) => handoverApi.history(root.id, { cursor: cursor || undefined, limit: 10 }, { signal }), enabled: open, staleTime: 0, retry: false });
  const detail = useQuery({ queryKey: handoverKeys.revision(scope, patientId, root.id, selected || ''), queryFn: ({ signal }) => handoverApi.revision(root.id, selected, { signal }), enabled: open && Boolean(selected), staleTime: 0, retry: false });
  useLayoutEffect(() => { if (query.error?.status === 403 || detail.error?.status === 403) onDenied(); }, [query.error?.status, detail.error?.status, onDenied]);
  return <section aria-label="Handover revision history" className="grid gap-3"><h3 className="font-medium">Revision history</h3>{query.isError ? <p role="alert">History could not be loaded. <Button type="button" variant="link" onClick={() => query.refetch()}>Refresh history</Button></p> : query.isFetching ? <p role="status">Loading history…</p> : <ul className="grid gap-2">{query.data?.rows.map((row) => <li key={row.id}><Button type="button" size="sm" variant="outline" onClick={() => setSelected(row.id)}>Review revision {row.revision} · {row.kind}</Button><p className="mt-1 text-xs text-muted-foreground">{row.recorded_by_display_name} · {new Date(row.recorded_at).toLocaleString()}</p></li>)}</ul>}<div className="flex gap-2">{previous.length > 0 && <Button type="button" size="sm" variant="outline" disabled={query.isFetching} onClick={() => { setCursor(previous.at(-1)); setPrevious((old) => old.slice(0, -1)); setSelected(null); }}>Previous revisions</Button>}{query.data?.hasNext && <Button type="button" size="sm" variant="outline" disabled={query.isFetching || query.isError} onClick={() => { setPrevious((old) => [...old, cursor]); setCursor(query.data.cursor); setSelected(null); }}>Next revisions</Button>}</div>{selected && (detail.isError ? <p role="alert">The selected evidence could not be loaded.</p> : detail.isFetching ? <p role="status">Loading revision evidence…</p> : detail.data && <HandoverEvidence revision={detail.data} title="Historical evidence" />)}</section>;
}
