import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { PageState } from '@/shared/components/page/PageState';
const Directory = lazy(() => import('./BookableServiceDirectoryPage'));
export default function BookableServiceRoute() {
  return isRustV2ApiMode() ? <Suspense fallback={<PageState variant="loading" title="Loading bookable services" />}><Directory /></Suspense> : <Navigate to="/appointments?tab=services" replace />;
}
