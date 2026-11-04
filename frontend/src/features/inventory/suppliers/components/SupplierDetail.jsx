import { useLayoutEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageState } from '@/shared/components/page/PageState';
import { inventorySupplierApi } from '../api';
import { supplierKeys } from '../keys';
import { useSupplierRead } from '../useSupplierRead';
import { SupplierCurrent } from './SupplierCurrent';
import { SupplierHistory } from './SupplierHistory';
import { SupplierPagination } from './DirectoryControls';
export function SupplierDetail({ supplierId, access, onDenied, onAction, onSourceChange, disabled }) {
 const [paging, setPaging] = useState({ cursors: [null], page: 0 });
 const params = { limit: 25, ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
 const detail = useSupplierRead({ access, queryKey: supplierKeys.detail(access.scope, supplierId), read: signal => inventorySupplierApi.get(supplierId, { signal }), onDenied });
 const history = useSupplierRead({ access, queryKey: supplierKeys.history(access.scope, supplierId, params), read: signal => inventorySupplierApi.history(supplierId, params, { signal }), onDenied, enabled: detail.current });
 useLayoutEffect(() => { onSourceChange({ data: detail.data, error: detail.error, fetching: detail.isFetching }); }, [detail.data, detail.error, detail.isFetching, onSourceChange]);
 if (detail.isFetching || !access.readReady) return <PageState variant="loading" title="Confirming current supplier" fullHeight={false} />;
 if (!detail.current) return <PageState variant="error" title="Supplier unavailable" description="Previous detail is hidden until a current authorized request succeeds." action={() => detail.refetch()} fullHeight={false} />;
 const { supplier, eligibility } = detail.value;
 return <div className="grid min-w-0 gap-6"><SupplierCurrent {...{ supplier, eligibility, access, onAction, disabled }} />
 <section className="grid min-w-0 gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-lg font-semibold">Supplier recording history</h2><Button type="button" variant="outline" disabled={history.isFetching} onClick={() => history.refetch()}>Refresh history</Button></div><p className="text-sm text-muted-foreground">Recording order, revisions and metadata change flags are preserved. Use current details to read contact information. The original result records exactly what was reviewed for that change.</p><SupplierHistory rows={history.value?.data ?? []} loading={history.isFetching} error={history.error || (!history.current && !history.isFetching)} onRetry={() => history.refetch()} /><SupplierPagination label="Supplier history pages" page={paging.page} hasNext={history.current && history.value.page.has_next} busy={history.isFetching} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={() => { const cursor = history.value?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); }} /></section></div>;
}
