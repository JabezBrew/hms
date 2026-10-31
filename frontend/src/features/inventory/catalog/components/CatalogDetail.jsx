import { useLayoutEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageState } from '@/shared/components/page/PageState';
import { inventoryCatalogApi } from '../api';
import { catalogKeys } from '../keys';
import { useCatalogRead } from '../useCatalogRead';
import { CatalogCurrentItem } from './CatalogCurrentItem';
import { CatalogHistory } from './CatalogHistory';
import { CatalogPagination } from './DirectoryControls';
export function CatalogDetail({ itemId, access, onDenied, onAction, onSourceChange, disabled }) {
 const [paging, setPaging] = useState({ cursors: [null], page: 0 });
 const params = { limit: 25, ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
 const detail = useCatalogRead({ access, queryKey: catalogKeys.detail(access.scope, itemId), read: signal => inventoryCatalogApi.get(itemId, { signal }), onDenied });
 const history = useCatalogRead({ access, queryKey: catalogKeys.history(access.scope, itemId, params), read: signal => inventoryCatalogApi.history(itemId, params, { signal }), onDenied, enabled: detail.current });
 useLayoutEffect(() => { onSourceChange({ data: detail.data, error: detail.error, fetching: detail.isFetching }); }, [detail.data, detail.error, detail.isFetching, onSourceChange]);
 if (detail.isFetching || !access.readReady) return <PageState variant="loading" title="Confirming current catalog item" fullHeight={false} />;
 if (!detail.current) return <PageState variant="error" title="Catalog item unavailable" description="Previous detail is hidden until a current authorized request succeeds." action={() => detail.refetch()} fullHeight={false} />;
 const { item, eligibility } = detail.value;
 return <div className="grid min-w-0 gap-6"><CatalogCurrentItem {...{ item, eligibility, access, onAction, disabled }} />
 <section className="grid min-w-0 gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-lg font-semibold">Catalog recording history</h2><Button type="button" variant="outline" disabled={history.isFetching} onClick={() => history.refetch()}>Refresh history</Button></div><p className="text-sm text-muted-foreground">Recording order is preserved. General history shows reason presence, with no actor or private reason text. Legacy dates do not activate future metadata.</p><CatalogHistory rows={history.value?.data ?? []} loading={history.isFetching} error={history.error || (!history.current && !history.isFetching)} onRetry={() => history.refetch()} /><CatalogPagination label="Catalog history pages" page={paging.page} hasNext={history.current && history.value.page.has_next} busy={history.isFetching} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={() => { const cursor = history.value?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); }} /></section></div>;
}
