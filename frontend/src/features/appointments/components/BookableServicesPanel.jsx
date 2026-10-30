import { lazy, Suspense } from 'react';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { PageState } from '@/shared/components/page/PageState';
const Current = lazy(() => import('../services/BookableServiceDirectoryPage'));
const Legacy = lazy(() => import('./LegacyBookableServicesPanel'));
export default function BookableServicesPanel(props) {
  const Component = isRustV2ApiMode() ? Current : Legacy;
  return <Suspense fallback={<PageState variant="loading" title="Loading bookable services" />}><Component {...props} /></Suspense>;
}
