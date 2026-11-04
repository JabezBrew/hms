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
import { inventorySupplierApi } from './api';
import { supplierKeys } from './keys';
import { inventoryKeys } from '@/hooks/useInventoryQueries';
import { validId } from './model';
import { useSupplierAccess } from './useSupplierAccess';
import { useSupplierRead } from './useSupplierRead';
import { useInventorySupplierCommand } from './useInventorySupplierCommand';
import { SupplierDirectory } from './components/SupplierDirectory';
import { SupplierChangeDialog } from './components/SupplierChangeDialog';
import { SupplierReloadRecovery } from './components/SupplierReloadRecovery';
import { SupplierDetail } from './components/SupplierDetail';
function Unavailable({ retry }) { return <PageShell><PageState variant="error" title="Inventory suppliers unavailable" description="Current inventory view authority, demographics visibility and the Inventory feature are required. Protected content and local review copies are hidden." action={retry} /></PageShell>; }
function restoreSupplierFocus(opener, fallback) {
 const target = [opener, fallback].find(element => element instanceof HTMLElement && element.isConnected && element.tabIndex >= 0
   && !element.matches(':disabled, [aria-disabled="true"]') && !element.closest('[hidden], [inert], [aria-hidden="true"]'));
 target?.focus();
}
function SupplierFrame({ access, onDenied }) {
 const client = useQueryClient(), navigate = useNavigate(), location = useLocation();
 const focusFallback = useRef(null), focusPath = useRef(location.pathname), captureFocus = useScopedNotifications(access.scope);
 useLayoutEffect(() => { focusPath.current = location.pathname; }, [location.pathname]);
 const captureReturnFocus = () => {
   const opener = document.activeElement, path = location.pathname, lease = captureFocus();
   // The workspace lease survives a successful dialog unmount, but not a
   // denied, replaced or different-route workspace.
   return () => { if (focusPath.current === path && lease.isCurrent()) restoreSupplierFocus(opener, focusFallback.current); };
 };
 const suffix = location.pathname.replace(/^\/inventory\/suppliers\/?/, ''), supplierId = suffix || null;
 const [detailSource, setDetailSource] = useState(null);
 const [paging, setPaging] = useState({ search: '', status: '', cursors: [null], page: 0 }), [selection, setSelection] = useState(null), [open, setOpen] = useState(false), [finishing, setFinishing] = useState(false), [error, setError] = useState(null);
 const params = { limit: 25, ...(paging.search ? { search: paging.search } : {}), ...(paging.status ? { is_active: paging.status === 'active' } : {}), ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
 const query = useSupplierRead({ access, queryKey: supplierKeys.page(access.scope, params), read: signal => inventorySupplierApi.list(params, { signal }), onDenied, enabled: supplierId === null });
 const sourceToken = useMemo(() => ({ data: query.data, error: query.error, fetching: query.isFetching, path: location.pathname, detailSource }), [query.data, query.error, query.isFetching, location.pathname, detailSource]);
 const refresh = () => Promise.all([client.invalidateQueries({ queryKey: supplierKeys.all(access.scope) }, { throwOnError: true }), client.invalidateQueries({ queryKey: inventoryKeys.items() }, { throwOnError: true }), client.invalidateQueries({ queryKey: inventoryKeys.suppliers() }, { throwOnError: true })]);
 const controller = useInventorySupplierCommand(access, onDenied, refresh);
 const barrier = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot), blocked = barrier.unavailable || barrier.entries.length > 0;
 const select = value => { if (!access.canWrite || controller.locked || blocked || finishing) return; setSelection(value); setOpen(true); setError(null); };
 const done = async () => { if (finishing || controller.busy) return; setFinishing(true); setError(null); try { await refresh(); controller.reset(); setSelection(null); setOpen(false); } catch { setError('The original result remains confirmed, but current suppliers refresh failed. Refresh before another change.'); } finally { setFinishing(false); } };
 const disabled = blocked || controller.locked || finishing || !access.canWrite || (supplierId === null && (!query.current || query.isFetching));
 if (supplierId !== null && !validId(supplierId)) return <Unavailable />;
 return <PageShell><PageHeader title={supplierId ? 'Inventory supplier' : 'Inventory suppliers'} description="Maintain supplier details and availability." actions={<div className="flex flex-wrap gap-2">{supplierId ? <Button ref={focusFallback} type="button" variant="outline" onClick={() => navigate('/inventory/suppliers')}>Back to suppliers</Button> : <Button ref={focusFallback} type="button" variant="outline" disabled={query.isFetching || controller.busy || !access.readReady} onClick={() => query.refetch()}>Refresh suppliers</Button>}{controller.locked && <Button type="button" variant="outline" onClick={() => setOpen(true)}>Review pending supplier change</Button>}{access.canManage && <Button type="button" disabled={disabled} onClick={() => select({ action: 'create' })}>Add supplier</Button>}</div>} />
 <div className="grid min-w-0 gap-6 p-4 sm:p-6">{!access.canWrite && <Alert><AlertTitle>Supplier is read-only</AlertTitle><AlertDescription>Browsing requires a confirmed connection. Changes and original receipts require current management authority and server-confirmed credentials. Confirmation does not grant additional permissions.</AlertDescription></Alert>}{blocked && !controller.unknown && <Alert><AlertTitle>A previous change needs review</AlertTitle><AlertDescription>Current supplier details and history cannot confirm whether a previous change was recorded. Notices without one identifiable original request must stay unresolved.</AlertDescription></Alert>}{blocked && !controller.locked && access.canManage && <SupplierReloadRecovery {...{ access, onDenied }} />}{error && <p role="alert">{error}</p>}
 {supplierId ? <SupplierDetail key={supplierId} supplierId={supplierId} access={access} onDenied={onDenied} onAction={select} onSourceChange={setDetailSource} disabled={disabled} /> : <SupplierDirectory {...{ access, query, paging, setPaging, controller, disabled, navigate }} />}
 <aside className="grid gap-2 rounded-xl border bg-muted/20 p-4"><h2 className="font-medium">Keep recorded work intact</h2><p className="text-sm text-muted-foreground">Supplier corrections preserve item bindings and recorded purchase-order names. Only unused suppliers can be retired or reactivated. Cached search results can show earlier supplier labels. Open supplier details to review the current record.</p></aside></div>
 {selection && <SupplierChangeDialog key={`${selection.action}:${selection.supplier?.id ?? 'new'}`} {...{ selection, open, access, controller, onDenied, sourceToken, finishing, captureReturnFocus }} onClose={() => { if (!controller.busy && !finishing) setOpen(false); }} onDone={done} />}</PageShell>;
}
function AuthorizedSuppliers({ access }) {
 const [denied, setDenied] = useState(false), [generation, setGeneration] = useState(0), onDenied = useCallback(() => setDenied(true), []);
 return denied ? <Unavailable retry={() => { setGeneration(old => old + 1); setDenied(false); }} /> : <SupplierFrame key={generation} access={access} onDenied={onDenied} />;
}
export default function InventorySupplierPage() {
 usePageMeta({ title: 'Inventory suppliers', breadcrumbs: [{ label: 'Inventory', path: '/inventory' }, { label: 'Suppliers', path: '/inventory/suppliers' }] });
 const access = useSupplierAccess();
 return isRustV2ApiMode() && access.canRead ? <AuthorizedSuppliers key={access.scope} access={access} /> : <Unavailable />;
}
