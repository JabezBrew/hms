import { useLayoutEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageState } from '@/shared/components/page/PageState';
import { inventoryCategoryApi } from '../api';
import { categoryKeys } from '../keys';
import { useCategoryRead } from '../useCategoryRead';
import { CategoryCurrent } from './CategoryCurrent';
import { CategoryHistory } from './CategoryHistory';
import { CategoryPagination } from './DirectoryControls';
export function CategoryDetail({ categoryId, access, onDenied, onAction, onSourceChange, disabled }) {
 const [paging, setPaging] = useState({ cursors: [null], page: 0 });
 const params = { limit: 25, ...(paging.cursors[paging.page] ? { cursor: paging.cursors[paging.page] } : {}) };
 const detail = useCategoryRead({ access, queryKey: categoryKeys.detail(access.scope, categoryId), read: signal => inventoryCategoryApi.get(categoryId, { signal }), onDenied });
 const history = useCategoryRead({ access, queryKey: categoryKeys.history(access.scope, categoryId, params), read: signal => inventoryCategoryApi.history(categoryId, params, { signal }), onDenied, enabled: detail.current });
 useLayoutEffect(() => { onSourceChange({ data: detail.data, error: detail.error, fetching: detail.isFetching }); }, [detail.data, detail.error, detail.isFetching, onSourceChange]);
 if (detail.isFetching || !access.readReady) return <PageState variant="loading" title="Confirming current category" fullHeight={false} />;
 if (!detail.current) return <PageState variant="error" title="Category unavailable" description="Previous detail is hidden until a current authorized request succeeds." action={() => detail.refetch()} fullHeight={false} />;
 const { category, eligibility } = detail.value;
 return <div className="grid min-w-0 gap-6"><CategoryCurrent {...{ category, eligibility, access, onAction, disabled }} />
 <section className="grid min-w-0 gap-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-lg font-semibold">Category recording history</h2><Button type="button" variant="outline" disabled={history.isFetching} onClick={() => history.refetch()}>Refresh history</Button></div><p className="text-sm text-muted-foreground">Recording order, revisions and metadata change flags are preserved. Description and original command content belong to their separately authorized views.</p><CategoryHistory rows={history.value?.data ?? []} loading={history.isFetching} error={history.error || (!history.current && !history.isFetching)} onRetry={() => history.refetch()} /><CategoryPagination label="Category history pages" page={paging.page} hasNext={history.current && history.value.page.has_next} busy={history.isFetching} onPrevious={() => setPaging(old => ({ ...old, page: old.page - 1 }))} onNext={() => { const cursor = history.value?.page.next_cursor; if (cursor) setPaging(old => ({ ...old, cursors: [...old.cursors.slice(0, old.page + 1), cursor], page: old.page + 1 })); }} /></section></div>;
}
