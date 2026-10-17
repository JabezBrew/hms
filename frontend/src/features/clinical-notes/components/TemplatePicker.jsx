import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageState } from '@/shared/components/page/PageState';
import { noteWorkspaceApi, templateRevision } from '../api/workspace';
import { readTemplateEvidence } from '../api/templateHistory';
import { noteKeys } from '../keys';
import { templateSchema } from '../model';

function SelectedTemplate({ id, scope, onSelect, onCancel, onDenied }) {
  const query = useQuery({ queryKey: noteKeys.template(scope, id), queryFn: ({ signal }) => readTemplateEvidence(() => noteWorkspaceApi.template(id, { signal }), signal, onDenied), retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  if (query.isError) return <Alert variant="destructive"><AlertDescription>Current template access could not be confirmed. <Button type="button" variant="link" onClick={() => query.refetch()}>Reload template</Button><Button type="button" variant="link" onClick={onCancel}>Back to templates</Button></AlertDescription></Alert>;
  if (!query.isFetchedAfterMount || query.isFetching || !query.data) return <p role="status">Loading current template revision…</p>;
  const template = query.data;
  return <section className="flex flex-col gap-3 rounded-xl border p-4"><h3 className="font-medium">{template.title}</h3><p className="text-sm text-muted-foreground">Revision {template.version} · {template.owner_display_name || (template.owner_user_id ? 'Owner name unavailable' : 'Historical owner not recorded')}</p><p className="text-sm">Selecting this revision keeps your existing text. Generate a patient-aware preview, review its proposed sections and explicitly apply them to the local draft. This exact revision will be retained with any later saved note.</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={!template.is_active || templateSchema(template.body_template).kind === 'invalid'} onClick={() => onSelect(templateRevision(template))}>Use this template revision</Button><Button type="button" variant="outline" onClick={onCancel}>Back to templates</Button></div>{templateSchema(template.body_template).kind === 'invalid' && <p role="alert">This historical template structure requires review and cannot be used for new notes.</p>}{!template.is_active && <p role="alert">This template is inactive. Choose an active template or a freeform note.</p>}</section>;
}
export function TemplatePicker({ scope, onSelect, onDenied }) {
  const [search, setSearch] = useState(''); const [term, setTerm] = useState(''); const [cursor, setCursor] = useState(null); const [previous, setPrevious] = useState([]); const [selected, setSelected] = useState(null);
  const params = { limit: 15, activity: 'active', search: term || undefined, cursor: cursor || undefined };
  const query = useQuery({ queryKey: noteKeys.catalog(scope, params), queryFn: ({ signal }) => readTemplateEvidence(() => noteWorkspaceApi.templates(params, { signal }), signal, onDenied), retry: false, staleTime: 0, gcTime: 0 });
  if (selected) return <SelectedTemplate key={selected} id={selected} scope={scope} onSelect={onSelect} onDenied={onDenied} onCancel={() => setSelected(null)} />;
  return <section aria-label="Note templates" className="flex flex-col gap-4"><form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); setTerm(search.trim()); setCursor(null); setPrevious([]); }}><div className="flex min-w-0 flex-1 flex-col gap-2"><Label htmlFor="note-template-search">Find a template</Label><Input id="note-template-search" value={search} maxLength={160} onChange={(event) => setSearch(event.target.value)} /></div><Button type="submit" variant="outline">Search templates</Button></form>
    {query.isError ? <PageState fullHeight={false} variant="error" title="Templates unavailable" description="This page could not be confirmed. Freeform notes remain available with your current clinical access." action={() => query.refetch()} /> : query.isFetching ? <p role="status">Loading template page…</p> : query.data?.rows.length ? <div className="grid gap-2 sm:grid-cols-2">{query.data.rows.map((item) => <Button key={item.id} type="button" variant="outline" className="h-auto min-w-0 justify-start whitespace-normal px-4 py-3 text-left" onClick={() => setSelected(item.id)}><span className="flex flex-col gap-1"><span>{item.title}</span><span className="text-xs text-muted-foreground">Revision {item.version}</span></span></Button>)}</div> : <p className="text-sm text-muted-foreground">No active templates match this search. You can write a freeform note.</p>}
    <nav aria-label="Template pages" className="flex flex-wrap gap-2">{previous.length > 0 && <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => { setCursor(previous.at(-1)); setPrevious((old) => old.slice(0, -1)); }}>Previous templates</Button>}{query.data?.hasNext && <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => { setPrevious((old) => [...old, cursor]); setCursor(query.data.cursor); }}>Next templates</Button>}</nav>
  </section>;
}
