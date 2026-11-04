import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getWriteUncertaintySnapshot, subscribeWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { laboratoryCatalogApi } from './api';
import { catalogKeys } from './keys';
import { validId } from './model';
import { useCatalogAccess } from './useCatalogAccess';
import { useCatalogRead } from './useCatalogRead';
import { useCatalogCommand } from './useCatalogCommand';
import { CatalogDirectory } from './components/CatalogDirectory';
import { CatalogDetail } from './components/CatalogDetail';
import { CatalogChangeDialog } from './components/CatalogChangeDialog';
import { CatalogReloadRecovery } from './components/CatalogReloadRecovery';
const ROOT = '/laboratory/catalog-administration';
const initialPaging = () => ({ search: '', category: '', status: '', defaults: '', modified: '', cursors: [null], page: 0 });
function Unavailable({ retry, confirm }) { return <PageShell><PageHeader title="Laboratory administration" actions={confirm && <Button type="button" variant="outline" onClick={confirm}>Confirm current sign-in</Button>} /><PageState variant="error" title="Catalog administration unavailable" description="Current laboratory catalog management and the Laboratory feature are required. Protected records and copied reviews stay hidden." action={retry} /></PageShell>; }
function restoreFocus(opener, fallback) {
  [opener, fallback].find(element => element instanceof HTMLElement && element.isConnected && element.tabIndex >= 0 && !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[hidden], [inert], [aria-hidden="true"]'))?.focus();
}
function CatalogFrame({ access, onDenied }) {
  const client = useQueryClient(), navigate = useNavigate(), location = useLocation(), fallback = useRef(null), path = useRef(location.pathname), capture = useScopedNotifications(access.scope);
  useLayoutEffect(() => { path.current = location.pathname; }, [location.pathname]);
  const captureReturnFocus = () => { const opener = document.activeElement, capturedPath = location.pathname, lease = capture(); return () => { if (path.current === capturedPath && lease.isCurrent()) restoreFocus(opener, fallback.current); }; };
  const match = /^\/laboratory\/catalog-administration(?:\/(tests|panels)(?:\/([^/]+))?)?\/?$/.exec(location.pathname), kind = match?.[1] === 'panels' ? 'panel' : 'test', id = match?.[2] || null;
  const [pages, setPages] = useState(() => ({ test: initialPaging(), panel: initialPaging() })), [detailSource, setDetailSource] = useState(null), [selection, setSelection] = useState(null), [open, setOpen] = useState(false), [finishing, setFinishing] = useState(false), [error, setError] = useState(null);
  const paging = pages[kind], setPaging = update => setPages(old => ({ ...old, [kind]: typeof update === 'function' ? update(old[kind]) : update }));
  const params = { limit: 25, ...(paging.search ? { search: paging.search } : {}), ...(kind === 'test' && paging.category ? { category: paging.category } : {}), ...(paging.status ? { is_active: paging.status === 'active' } : {}), ...(paging.defaults ? { is_system_default: paging.defaults === 'yes' } : {}), ...(paging.modified ? { is_facility_modified: paging.modified === 'yes' } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
  const query = useCatalogRead({ access, queryKey: catalogKeys.page(access.scope, kind, params), read: signal => laboratoryCatalogApi.list(kind, params, { signal }), onDenied, enabled: id === null && Boolean(match) });
  const refresh = () => client.invalidateQueries({ queryKey: catalogKeys.all(access.scope) }, { throwOnError: true });
  const controller = useCatalogCommand(access, onDenied, refresh);
  const barrier = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot), blocked = barrier.unavailable || barrier.entries.length > 0;
  const sourceToken = useMemo(() => ({ data: query.data, error: query.error, fetching: query.isFetching, path: location.pathname, detailSource }), [query.data, query.error, query.isFetching, location.pathname, detailSource]);
  const select = subject => { if (!access.canWrite || blocked || controller.locked || finishing) return; setSelection(subject); setOpen(true); setError(null); };
  const done = async () => { if (finishing || controller.busy) return; setFinishing(true); setError(null); try { await refresh(); controller.reset(); setSelection(null); setOpen(false); } catch { setError('The original result remains confirmed, but current definitions could not refresh. Refresh before another change.'); } finally { setFinishing(false); } };
  const changeKind = next => { setPages(old => ({ ...old, [next]: initialPaging() })); navigate(`${ROOT}/${next === 'test' ? 'tests' : 'panels'}`); };
  if (!match || (id !== null && !validId(id))) return <Unavailable />;
  return <PageShell><PageHeader title={id ? `Laboratory ${kind}` : 'Laboratory catalog administration'} description="Review definitions and manage future ordering availability." actions={<div className="flex flex-wrap gap-2">{id ? <Button ref={fallback} type="button" variant="outline" disabled={controller.busy} onClick={() => navigate(`${ROOT}/${kind === 'test' ? 'tests' : 'panels'}`)}>Back to definitions</Button> : <Button ref={fallback} type="button" variant="outline" disabled={query.isFetching || controller.busy || !access.readReady} onClick={() => query.refetch()}>Refresh definitions</Button>}{access.requestReauthentication && <Button type="button" variant="outline" disabled={controller.busy || finishing} onClick={access.requestReauthentication}>Confirm current sign-in</Button>}{controller.locked && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Review pending availability change</Button>}</div>} /><div className="grid min-w-0 gap-6 p-4 sm:p-6"><nav aria-label="Catalog administration type" className="flex flex-wrap gap-2">{['test', 'panel'].map(value => <Button key={value} type="button" variant={kind === value ? 'default' : 'outline'} aria-current={kind === value ? 'page' : undefined} disabled={controller.busy || finishing} onClick={() => changeKind(value)}>{value === 'test' ? 'Tests' : 'Panels'}</Button>)}</nav>
    {!access.canWrite && <Alert><AlertTitle>Availability changes are read-only</AlertTitle><AlertDescription>Definitions can be read with current management authority. Changes and original receipts also require server-confirmed current credentials and a writable connection.</AlertDescription></Alert>}{blocked && !controller.unknown && <Alert><AlertTitle>A previous change needs review</AlertTitle><AlertDescription>Current definitions and history cannot establish a missing command outcome. Keep an unidentifiable recovery notice unresolved.</AlertDescription></Alert>}{blocked && !controller.locked && <CatalogReloadRecovery access={access} onDenied={onDenied} />}{error && <p role="alert">{error}</p>}
    {id ? <CatalogDetail key={`${kind}:${id}`} {...{ kind, id, access, onDenied }} onAction={select} onSourceChange={setDetailSource} disabled={blocked || controller.locked || finishing || !access.canWrite} /> : <CatalogDirectory key={kind} {...{ kind, query, paging, setPaging }} onView={value => navigate(`${ROOT}/${kind === 'test' ? 'tests' : 'panels'}/${value}`)} />}
  </div>{selection && <CatalogChangeDialog key={`${selection.kind}:${selection.definition.id}`} {...{ selection, open, access, controller, onDenied, sourceToken, finishing, captureReturnFocus }} onClose={() => { if (!controller.busy && !finishing) setOpen(false); }} onDone={done} />}</PageShell>;
}
function AuthorizedCatalog({ access }) {
  const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0), onDenied = useCallback(() => setDenied(true), []);
  return denied ? <Unavailable confirm={access.requestReauthentication} retry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <CatalogFrame key={generation} {...{ access, onDenied }} />;
}
export default function LabCatalogAdministrationPage() {
  usePageMeta({ title: 'Laboratory catalog administration', breadcrumbs: [{ label: 'Catalog administration', path: ROOT }] });
  const access = useCatalogAccess();
  return isRustV2ApiMode() && access.canRead ? <AuthorizedCatalog key={access.scope} access={access} /> : <Unavailable />;
}
