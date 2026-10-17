import { useLayoutEffect, useState } from 'react';
import { ResponseButton as Button } from './ResponseButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useResponseHistory, useResponseVersion } from '../hooks/queries';
import { responseLabels } from '../model';
import { ResponseEvidence } from './ResponseEvidence';
function HistoryPage({ query, cursors, setCursors, setSelectedId }) {
  if (!query.isFetchedAfterMount || query.isError || !query.data) return null;
  return <><div className="flex flex-col gap-2">{query.data.rows.length ? query.data.rows.map(row => <Button key={row.id} type="button" variant="outline" className="h-auto justify-start whitespace-normal py-3 text-left" disabled={query.isFetching} onClick={() => setSelectedId(row.id)}>Version {row.version} · {responseLabels[row.operation]} · {row.status}</Button>) : <p className="text-sm">No response versions are recorded.</p>}</div>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={query.isFetching || cursors.length < 2} onClick={() => { setCursors(old => old.slice(0, -1)); setSelectedId(null); }}>Previous history page</Button><Button type="button" variant="outline" disabled={query.isFetching || !query.data.hasNext} onClick={() => { setCursors(old => [...old, query.data.cursor]); setSelectedId(null); }}>Next history page</Button></div></>;
}
function SelectedVersion({ version, selectedId }) {
  if (version.isError) return <Alert variant="destructive"><AlertDescription>The exact saved revision could not be confirmed. No current-response substitute is shown.</AlertDescription></Alert>;
  if (selectedId && version.isFetching) return <p role="status">Reading the exact saved revision…</p>;
  if (!version.isFetchedAfterMount || !version.data) return null;
  return <ResponseEvidence response={version.data} title="Original saved response" />;
}
export function ResponseHistory({ scope, proof, enabled, onDenied }) {
  const [cursors, setCursors] = useState([null]); const [selectedId, setSelectedId] = useState(null);
  const cursor = cursors.at(-1); const query = useResponseHistory(scope, proof, { limit: 25, ...(cursor ? { cursor } : {}) }, enabled);
  const version = useResponseVersion(scope, proof, selectedId, enabled);
  const denied = [query.error, version.error].some(error => error?.status === 403);
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  if (!enabled || denied) return null;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Referral response history">
    <p className="text-sm text-muted-foreground">History is a bounded page of recorded metadata. Select one exact version to read its original response. Recorded status and priority may differ from the current referral.</p>
    {query.isError && <Alert variant="destructive"><AlertDescription>Response history could not be confirmed. Earlier cached content is hidden.</AlertDescription></Alert>}
    {query.isLoading && <p role="status">Loading response history…</p>}
    <HistoryPage {...{ query, cursors, setCursors, setSelectedId }} />
    <SelectedVersion {...{ version, selectedId }} />
  </section>;
}
