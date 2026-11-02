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
import { inventoryCategoryApi } from './api';
import { categoryKeys } from './keys';
import { inventoryKeys } from '@/hooks/useInventoryQueries';
import { catalogKeys } from '../catalog/keys';
import { validId } from './model';
import { useCategoryAccess } from './useCategoryAccess';
import { useCategoryRead } from './useCategoryRead';
import { useInventoryCategoryCommand } from './useInventoryCategoryCommand';
import { CategoryDirectory } from './components/CategoryDirectory';
import { CategoryChangeDialog } from './components/CategoryChangeDialog';
import { CategoryReloadRecovery } from './components/CategoryReloadRecovery';
import { CategoryDetail } from './components/CategoryDetail';
function Unavailable({ retry }) { return <PageShell><PageState variant="error" title="Inventory categories unavailable" description="Current inventory view authority, demographics visibility and the Inventory feature are required. Protected content and local review copies are hidden." action={retry} /></PageShell>; }
function restoreCategoryFocus(opener, fallback) {
 const target = [opener, fallback].find(element => element instanceof HTMLElement && element.isConnected && element.tabIndex >= 0
   && !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[hidden], [inert], [aria-hidden="true"]'));
 target?.focus();
}
function CategoryFrame({ access, onDenied }) {
 const client = useQueryClient(), navigate = useNavigate(), location = useLocation();
 const focusFallback = useRef(null), focusPath = useRef(location.pathname), captureFocus = useScopedNotifications(access.scope);
 useLayoutEffect(() => { focusPath.current = location.pathname; }, [location.pathname]);
 const captureReturnFocus = () => {
   const opener = document.activeElement, path = location.pathname, lease = captureFocus();
   // The workspace lease survives a successful dialog unmount, but not a
   // denied, replaced or different-route workspace.
   return () => { if (focusPath.current === path && lease.isCurrent()) restoreCategoryFocus(opener, focusFallback.current); };
 };
 const suffix = location.pathname.replace(/^\/inventory\/categories\/?/, ''), categoryId = suffix || null;
 const [detailSource, setDetailSource] = useState(null);
 const [paging, setPaging] = useState({ search: '', status: '', cursors: [null], page: 0 }), [selection, setSelection] = useState(null), [open, setOpen] = useState(false), [finishing, setFinishing] = useState(false), [error, setError] = useState(null);
 const params = { limit: 25, ...(paging.search ? { search: paging.search } : {}), ...(paging.status ? { is_active: paging.status === 'active' } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
 const query = useCategoryRead({ access, queryKey: categoryKeys.page(access.scope, params), read: signal => inventoryCategoryApi.list(params, { signal }), onDenied, enabled: categoryId === null });
 const sourceToken = useMemo(() => ({ data: query.data, error: query.error, fetching: query.isFetching, path: location.pathname, detailSource }), [query.data, query.error, query.isFetching, location.pathname, detailSource]);
 const refresh = () => Promise.all([client.invalidateQueries({ queryKey: categoryKeys.all(access.scope) }, { throwOnError: true }), client.invalidateQueries({ queryKey: catalogKeys.all(access.scope) }, { throwOnError: true }), client.invalidateQueries({ queryKey: inventoryKeys.items() }, { throwOnError: true }), client.invalidateQueries({ queryKey: inventoryKeys.categories() }, { throwOnError: true })]);
 const controller = useInventoryCategoryCommand(access, onDenied, refresh);
 const barrier = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot), blocked = barrier.unavailable || barrier.entries.length > 0;
 const select = value => { if (!access.canWrite || controller.locked || blocked || finishing) return; setSelection(value); setOpen(true); setError(null); };
 const done = async () => { if (finishing || controller.busy) return; setFinishing(true); setError(null); try { await refresh(); controller.reset(); setSelection(null); setOpen(false); } catch { setError('The original result remains confirmed, but current categories refresh failed. Refresh before another change.'); } finally { setFinishing(false); } };
 const disabled = blocked || controller.locked || finishing || !access.canWrite || (categoryId === null && (!query.current || query.isFetching));
 if (categoryId !== null && !validId(categoryId)) return <Unavailable />;
 return <PageShell><PageHeader title={categoryId ? 'Inventory category' : 'Inventory categories'} description="Review category metadata, direct grouping and active selection." actions={<div className="flex flex-wrap gap-2">{categoryId ? <Button ref={focusFallback} type="button" variant="outline" onClick={() => navigate('/inventory/categories')}>Back to categories</Button> : <Button ref={focusFallback} type="button" variant="outline" disabled={query.isFetching || controller.busy || !access.readReady} onClick={() => query.refetch()}>Refresh categories</Button>}{controller.locked && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Review pending category change</Button>}{access.canManage && <Button type="button" disabled={disabled} onClick={() => select({ action: 'create' })}>Add category</Button>}</div>} />
 <div className="grid min-w-0 gap-6 p-4 sm:p-6">{!access.canWrite && <Alert><AlertTitle>Category is read-only</AlertTitle><AlertDescription>Browsing requires a confirmed connection. Changes and original receipts require current management authority and server-confirmed credentials. Confirmation does not grant additional permissions.</AlertDescription></Alert>}{blocked && !controller.unknown && <Alert><AlertTitle>A previous change needs review</AlertTitle><AlertDescription>Current category, parent and history reads cannot establish an original command outcome. Keep old unkeyed or ambiguous notices unresolved.</AlertDescription></Alert>}{blocked && !controller.locked && access.canManage && <CategoryReloadRecovery {...{ access, onDenied }} />}{error && <p role="alert">{error}</p>}
 {categoryId ? <CategoryDetail key={categoryId} categoryId={categoryId} access={access} onDenied={onDenied} onAction={select} onSourceChange={setDetailSource} disabled={disabled} /> : <CategoryDirectory {...{ access, query, paging, setPaging, controller, disabled, navigate }} />}
 <aside className="grid gap-2 rounded-xl border bg-muted/20 p-4"><h2 className="font-medium">Keep recorded work intact</h2><p className="text-sm text-muted-foreground">Metadata correction preserves item bindings and child pointers. Active state changes require an unused category. General item search may keep an older local category label until an explicit operator rebuild.</p></aside></div>
 {selection && <CategoryChangeDialog key={`${selection.action}:${selection.category?.id ?? 'new'}`} {...{ selection, open, access, controller, onDenied, sourceToken, finishing, captureReturnFocus }} onClose={() => { if (!controller.busy && !finishing) setOpen(false); }} onDone={done} />}</PageShell>;
}
function AuthorizedCategories({ access }) {
 const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0), onDenied = useCallback(() => setDenied(true), []);
 return denied ? <Unavailable retry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <CategoryFrame key={generation} access={access} onDenied={onDenied} />;
}
export default function InventoryCategoryPage() {
 usePageMeta({ title: 'Inventory categories', breadcrumbs: [{ label: 'Inventory', path: '/inventory' }, { label: 'Categories', path: '/inventory/categories' }] });
 const access = useCategoryAccess();
 return isRustV2ApiMode() && access.canRead ? <AuthorizedCategories key={access.scope} access={access} /> : <Unavailable />;
}
