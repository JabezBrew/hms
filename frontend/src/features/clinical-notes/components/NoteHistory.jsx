import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { noteWorkspaceApi } from '../api/workspace';
import { noteKeys } from '../keys';
import { NoteEvidence } from './NoteEvidence';

function HistoricalVersion({ id, selected, scope, patientId, onDenied }) {
  const query = useQuery({ queryKey: noteKeys.version(scope, patientId, id, selected.id), queryFn: async ({ signal }) => { try { return await noteWorkspaceApi.version(id, selected.id, { signal }); } catch (error) { if (!signal.aborted && error.status === 403) onDenied?.(); throw error; } }, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  if (query.isError) return <Alert variant="destructive"><AlertDescription>The selected historical content could not be confirmed. <Button type="button" variant="link" onClick={() => query.refetch()}>Reload selected version</Button></AlertDescription></Alert>;
  if (!query.isFetchedAfterMount || !query.data || query.isFetching) return <p role="status">Loading selected recorded version…</p>;
  if (query.data.version !== selected.version) return <p role="alert">The selected version number did not match its evidence.</p>;
  return <NoteEvidence note={{ ...query.data, title: `Recorded version ${query.data.version}`, author_display_name: query.data.recorded_by_display_name }} title="Historical note version" />;
}
export function NoteHistory({ id, patientId, scope, onDenied }) {
  const [cursor, setCursor] = useState(null); const [previous, setPrevious] = useState([]); const [selected, setSelected] = useState(null);
  const params = { limit: 20, cursor: cursor || undefined };
  const query = useQuery({ queryKey: noteKeys.history(scope, patientId, id, cursor), queryFn: async ({ signal }) => { try { return await noteWorkspaceApi.history(id, params, { signal }); } catch (error) { if (!signal.aborted && error.status === 403) onDenied?.(); throw error; } }, retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  return <section aria-label="Recorded note history" className="flex flex-col gap-4"><h3 className="font-medium">Recorded versions</h3><p className="text-sm text-muted-foreground">Each page lists saved version evidence. Choose a version to load its original content.</p>{query.isError ? <Alert variant="destructive"><AlertDescription>History could not be confirmed. <Button type="button" variant="link" onClick={() => query.refetch()}>Reload history</Button></AlertDescription></Alert> : !query.isFetchedAfterMount || query.isFetching ? <p role="status">Loading recorded versions…</p> : <div className="flex flex-col gap-2">{query.data?.rows.map((item) => <Button key={item.id} type="button" variant="outline" className="h-auto justify-start whitespace-normal py-3 text-left" onClick={() => setSelected(item)}><span className="flex flex-col gap-1"><span>Version {item.version} · {new Date(item.created_at).toLocaleString()}</span><span className="text-xs text-muted-foreground">{item.recorded_by_display_name || 'Historical author not recorded'}{item.edit_reason && ` · ${item.edit_reason}`}</span></span></Button>)}{!query.data?.rows.length && <p>No version evidence was returned.</p>}</div>}<nav aria-label="Note history pages" className="flex flex-wrap gap-2">{previous.length > 0 && <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => { setCursor(previous.at(-1)); setPrevious((old) => old.slice(0, -1)); setSelected(null); }}>Previous versions</Button>}{query.data?.hasNext && <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => { setPrevious((old) => [...old, cursor]); setCursor(query.data.cursor); setSelected(null); }}>Older versions</Button>}</nav>{selected && !query.isError && <HistoricalVersion key={selected.id} {...{ id, selected, scope, patientId, onDenied }} />}</section>;
}
