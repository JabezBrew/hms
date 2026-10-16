import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useNoteAccess } from '../hooks/useNoteAccess';
import { useNoteCommand } from '../hooks/useNoteCommand';
import { noteWorkspaceApi } from '../api/workspace';
import { noteKeys } from '../keys';
import { TemplateRevisionDialog } from '../components/TemplateRevisionDialog';
import { TemplateEvidence } from '../components/TemplateEvidence';
import { inferClinicalNoteTypeForRole } from '../noteTypes';
import { templateSchema } from '../model';

function CurrentTemplate({ id, scope, canWrite, locked, onEdit }) {
  const query = useQuery({ queryKey: noteKeys.template(scope, id), queryFn: ({ signal }) => noteWorkspaceApi.template(id, { signal }), retry: false, staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  if (query.isError) return <PageState fullHeight={false} variant="error" title="Template unavailable" description="The current template could not be confirmed. Cached content is hidden." action={() => query.refetch()} />;
  if (!query.isFetchedAfterMount || query.isFetching || !query.data) return <p role="status">Loading current template…</p>;
  const malformed = templateSchema(query.data.body_template).kind === 'invalid';
  return <div className="flex flex-col gap-3"><TemplateEvidence template={query.data} />{canWrite && query.data.can_manage && (query.data.is_active || !malformed) ? <Button type="button" variant="outline" disabled={locked} onClick={() => onEdit(query.data)}>{malformed ? 'Deactivate historical template' : 'Edit template and availability'}</Button> : <p className="text-sm text-muted-foreground">{malformed && !query.data.is_active ? 'This historical template is already inactive. Its original evidence remains available to read.' : 'Changes require current owner or explicit administrative authority and clinical management permission.'}</p>}</div>;
}
function Catalog({ scope, canManageTemplates, user }) {
  const meta = usePageMeta({ title: 'Clinical note templates | HMS', breadcrumbs: [{ label: 'Clinical note templates', path: '/clinical-notes/templates' }] });
  const controller = useNoteCommand(scope, null);
  const [search, setSearch] = useState(''); const [term, setTerm] = useState(''); const [activity, setActivity] = useState('active'); const [cursor, setCursor] = useState(null); const [previous, setPrevious] = useState([]);
  const [selected, setSelected] = useState(null); const [editor, setEditor] = useState(null); const [editorOpen, setEditorOpen] = useState(false);
  const params = { limit: 25, search: term || undefined, activity, cursor: cursor || undefined };
  const query = useQuery({ queryKey: noteKeys.catalog(scope, params), queryFn: ({ signal }) => noteWorkspaceApi.templates(params, { signal }), retry: false, staleTime: 0, gcTime: 0 });
  const locked = controller.busy || controller.unknown;
  const edit = (source = null) => { if (locked) return; controller.reset(); setEditor({ source, key: crypto.randomUUID() }); setEditorOpen(true); };
  const resetPage = () => { setCursor(null); setPrevious([]); };
  return <PageShell>{meta}<PageHeader title="Clinical note templates" description="Shared facility templates with captured revisions. Patient notes remain in the Patient Chronicle." actions={canManageTemplates ? <Button type="button" disabled={locked} onClick={() => edit()}>Create note template</Button> : null} /><div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6">
    {controller.unknown && !editorOpen && <Alert variant="destructive"><AlertDescription>A template change still needs its saved result checked. <Button type="button" variant="link" onClick={() => setEditorOpen(true)}>Review pending template change</Button></AlertDescription></Alert>}
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setTerm(search.trim()); resetPage(); }}><div className="flex min-w-0 flex-1 flex-col gap-2"><Label htmlFor="template-catalog-search">Search template titles</Label><Input id="template-catalog-search" value={search} maxLength={160} onChange={(event) => setSearch(event.target.value)} /></div><div className="flex flex-col gap-2"><Label htmlFor="template-catalog-activity">Availability</Label><Select value={activity} onValueChange={(value) => { setActivity(value); resetPage(); }}><SelectTrigger id="template-catalog-activity"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="all">All templates</SelectItem></SelectGroup></SelectContent></Select></div><Button type="submit" variant="outline">Search templates</Button></form>
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]"><section aria-label="Template catalog" className="flex min-w-0 flex-col gap-3">{query.isError ? <PageState fullHeight={false} variant="error" title="Templates unavailable" description="This catalog page could not be confirmed." action={() => query.refetch()} /> : query.isFetching ? <p role="status">Loading template page…</p> : query.data?.rows.length ? query.data.rows.map((item) => <Button key={item.id} type="button" variant="outline" className="h-auto min-w-0 justify-start whitespace-normal p-4 text-left" onClick={() => setSelected(item.id)}><span className="flex flex-col gap-1"><span>{item.title}</span><span className="text-xs text-muted-foreground">Revision {item.version} · {item.is_active ? 'Active' : 'Inactive'}</span></span></Button>) : <p className="text-sm text-muted-foreground">No templates match this page and search.</p>}<nav aria-label="Template catalog pages" className="flex flex-wrap gap-2">{previous.length > 0 && <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => { setCursor(previous.at(-1)); setPrevious((old) => old.slice(0, -1)); }}>Previous templates</Button>}{query.data?.hasNext && <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => { setPrevious((old) => [...old, cursor]); setCursor(query.data.cursor); }}>Next templates</Button>}</nav></section><section className="min-w-0">{selected ? <CurrentTemplate key={selected} id={selected} scope={scope} canWrite={canManageTemplates} locked={locked} onEdit={edit} /> : <p className="rounded-xl border p-5 text-sm text-muted-foreground">Select a template to load its current revision and availability. New notes retain the revision explicitly selected by their clinician.</p>}</section></div>
  </div>{editor && <TemplateRevisionDialog key={editor.key} defaultNoteType={inferClinicalNoteTypeForRole(user?.role || user?.user_type)} open={editorOpen} source={editor.source} controller={controller} canWrite={canManageTemplates} onClose={() => { if (!controller.busy) setEditorOpen(false); }} />}</PageShell>;
}
export default function RustTemplateCatalogPage() {
  const access = useNoteAccess();
  if (!access.canReadTemplates) return <PageState variant="error" title="Template access unavailable" description="Current clinical feature access and clinical documentation permission are required." />;
  return <Catalog key={access.scope} {...access} />;
}
