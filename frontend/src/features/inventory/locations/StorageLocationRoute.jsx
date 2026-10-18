import { lazy, Suspense } from 'react';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { PageState } from '@/shared/components/page/PageState';
const CurrentPage = lazy(() => import('./StorageLocationDirectoryPage'));
const LegacyPage = lazy(() => import('../pages/LocationsPage'));
export default function StorageLocationRoute() {
  const Component = isRustV2ApiMode() ? CurrentPage : LegacyPage;
  return <Suspense fallback={<PageState variant="loading" title="Loading storage locations" />}><Component /></Suspense>;
}
