import { useLayoutEffect, useState } from 'react';
import { MoveButton as Button } from './MoveButton';
import { MoveEvidence, PlacementLabels } from './PlacementEvidence';
import { useMoveDetail, useMoveHistory } from '../hooks/queries';
export function MoveHistory({ scope, proof, enabled, onDenied }) {
  const [cursors, setCursors] = useState([null]), [selected, setSelected] = useState(null);
  const cursor = cursors.at(-1), query = useMoveHistory(scope, proof, { limit: 25, ...(cursor ? { cursor } : {}) }, enabled);
  const detail = useMoveDetail(scope, proof, selected, enabled);
  const denied = [query.error, detail.error].some(error => error?.status === 403);
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  if (!enabled || denied) return null;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Recorded admission moves">
    <p className="text-sm text-muted-foreground">This is a bounded page of recorded moves. Select a move to read its original reason, routing and cleaning result. Unknown earlier placement history is not reconstructed.</p>
    <HistoryPage {...{ query, cursors, setCursors, setSelected }} />
    <ExactMove {...{ detail, selected }} />
  </section>;
}
function HistoryPage({ query, cursors, setCursors, setSelected }) {
  if (query.isError) return <p role="alert">Move history could not be confirmed. Cached history is hidden.</p>;
  if (!query.isFetchedAfterMount || query.isFetching) return <p role="status">Loading move history…</p>;
  return <>
    {query.data?.rows.length ? query.data.rows.map(row => <Button type="button" variant="outline" key={row.id} className="justify-start py-3 text-left" onClick={() => setSelected(row.id)}><span><PlacementLabels labels={row.source} /> → <PlacementLabels labels={row.destination} /><span className="mt-1 block text-xs">{new Date(row.moved_at).toLocaleString()} · {row.recorded_by_display_name}</span></span></Button>) : <p>No recorded moves for this admission.</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={cursors.length < 2} onClick={() => { setCursors(old => old.slice(0, -1)); setSelected(null); }}>Previous move page</Button><Button type="button" variant="outline" disabled={!query.data?.hasNext} onClick={() => { setCursors(old => [...old, query.data.cursor]); setSelected(null); }}>Next move page</Button></div>
  </>;
}
function ExactMove({ detail, selected }) {
  if (detail.isError) return <p role="alert">The exact recorded move is unavailable. No current-placement substitute is shown.</p>;
  if (selected && detail.isFetching) return <p role="status">Reading the exact recorded move…</p>;
  return detail.isFetchedAfterMount && detail.data ? <MoveEvidence movement={detail.data} /> : null;
}
