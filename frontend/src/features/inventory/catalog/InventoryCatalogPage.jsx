import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getWriteUncertaintySnapshot, subscribeWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { inventoryCatalogApi } from './api';
import { catalogKeys } from './keys';
import { validId } from './model';
import { useCatalogAccess } from './useCatalogAccess';
import { useCatalogRead } from './useCatalogRead';
import { useInventoryItemCommand } from './useInventoryItemCommand';
import { CatalogDirectory } from './components/CatalogDirectory';
import { CatalogChangeDialog } from './components/CatalogChangeDialog';
import { CatalogReloadRecovery } from './components/CatalogReloadRecovery';
import { CatalogDetail } from './components/CatalogDetail';
function Unavailable({ retry }) { return <PageShell><PageState variant="error" title="Inventory catalog unavailable" description="Current inventory view authority, demographics visibility and the Inventory feature are required. Protected content and local review copies are hidden." action={retry} /></PageShell>; }
function CatalogFrame({ access, onDenied }) {
 const client = useQueryClient(), navigate = useNavigate(), location = useLocation();
 const suffix = location.pathname.replace(/^\/inventory\/catalog\/?/, ''), itemId = suffix || null;
 const [detailSource, setDetailSource] = useState(null);
 const [paging, setPaging] = useState({ search: '', status: '', cursors: [null], page: 0 }), [selection, setSelection] = useState(null), [open, setOpen] = useState(false), [finishing, setFinishing] = useState(false), [error, setError] = useState(null);
 const params = { limit: 25, ...(paging.search ? { search: paging.search } : {}), ...(paging.status ? { is_active: paging.status === 'active' } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
 const query = useCatalogRead({ access, queryKey: catalogKeys.page(access.scope, params), read: signal => inventoryCatalogApi.list(params, { signal }), onDenied, enabled: itemId === null });
 const sourceToken = useMemo(() => ({ data: query.data, error: query.error, fetching: query.isFetching, path: location.pathname, detailSource }), [query.data, query.error, query.isFetching, location.pathname, detailSource]);
 const refresh = () => Promise.all([client.invalidateQueries({ queryKey: catalogKeys.all(access.scope) }, { throwOnError: true }), client.invalidateQueries({ queryKey: ['inventory'] }, { throwOnError: true })]);
 const controller = useInventoryItemCommand(access, onDenied, refresh);
 const barrier = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot), blocked = barrier.unavailable || barrier.entries.length > 0;
 const select = value => { if (!access.canWrite || controller.locked || blocked || finishing) return; setSelection(value); setOpen(true); setError(null); };
 const done = async () => { if (finishing || controller.busy) return; setFinishing(true); setError(null); try { await refresh(); controller.reset(); setSelection(null); setOpen(false); } catch { setError('The original result remains confirmed, but current catalog refresh failed. Refresh before another change.'); } finally { setFinishing(false); } };
 const disabled = blocked || controller.locked || finishing || !access.canWrite || (itemId === null && (!query.current || query.isFetching));
 if (itemId !== null && !validId(itemId)) return <Unavailable />;
 return <PageShell><PageHeader title={itemId ? 'Catalog item' : 'Inventory catalog'} description="Review item identity, stock units and active selection while keeping recorded operations intact." actions={<div className="flex flex-wrap gap-2">{itemId ? <Button type="button" variant="outline" onClick={() => navigate('/inventory/catalog')}>Back to catalog</Button> : <Button type="button" variant="outline" disabled={query.isFetching || controller.busy || !access.readReady} onClick={() => query.refetch()}>Refresh catalog</Button>}{controller.locked && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Review pending catalog change</Button>}{access.canManage && <Button type="button" disabled={disabled} onClick={() => select({ action: 'create' })}>Add catalog item</Button>}</div>} />
 <div className="grid min-w-0 gap-6 p-4 sm:p-6">{!access.canWrite && <Alert><AlertTitle>Catalog is read-only</AlertTitle><AlertDescription>Browsing requires a confirmed connection. Changes and original receipts require current management authority and server-confirmed credentials. Confirmation does not grant additional permissions.</AlertDescription></Alert>}{blocked && !controller.unknown && <Alert><AlertTitle>A previous change needs review</AlertTitle><AlertDescription>Current item and history reads cannot establish an original command outcome. Keep old unkeyed or ambiguous notices unresolved.</AlertDescription></Alert>}{blocked && !controller.locked && access.canManage && <CatalogReloadRecovery {...{ access, onDenied }} />}{error && <p role="alert">{error}</p>}
 {itemId ? <CatalogDetail key={itemId} itemId={itemId} access={access} onDenied={onDenied} onAction={select} onSourceChange={setDetailSource} disabled={disabled} /> : <CatalogDirectory {...{ access, query, paging, setPaging, controller, disabled, navigate }} />}
 <aside className="grid gap-2 rounded-xl border bg-muted/20 p-4"><h2 className="font-medium">Keep recorded work intact</h2><p className="text-sm text-muted-foreground">A dated correction applies current metadata when recorded. It does not schedule future activation or rewrite stock, pricing or care. Changing unit or active state can be blocked by any retained operational reference, even completed work or zero stock.</p></aside></div>
 {selection && <CatalogChangeDialog key={`${selection.action}:${selection.item?.id ?? 'new'}`} {...{ selection, open, access, controller, onDenied, sourceToken, finishing }} onClose={() => { if (!controller.busy && !finishing) setOpen(false); }} onDone={done} />}</PageShell>;
}
function AuthorizedCatalog({ access }) {
 const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0), onDenied = useCallback(() => setDenied(true), []);
 return denied ? <Unavailable retry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <CatalogFrame key={generation} access={access} onDenied={onDenied} />;
}
export default function InventoryCatalogPage() {
 usePageMeta({ title: 'Inventory catalog', breadcrumbs: [{ label: 'Inventory', path: '/inventory' }, { label: 'Catalog', path: '/inventory/catalog' }] });
 const access = useCatalogAccess();
 return isRustV2ApiMode() && access.canRead ? <AuthorizedCatalog key={access.scope} access={access} /> : <Unavailable />;
}
