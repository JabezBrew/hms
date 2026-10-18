import { lazy, Suspense } from 'react';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { PageState } from '@/shared/components/page/PageState';
const OrganizationDirectoryPage = lazy(() => import('./OrganizationDirectoryPage'));
const LegacyOrganizationPage = lazy(() => import('../pages/organization/OrganizationPage'));
export default function OrganizationRoute() {
  const Component = isRustV2ApiMode() ? OrganizationDirectoryPage : LegacyOrganizationPage;
  return <Suspense fallback={<PageState variant="loading" title="Loading organization" />}><Component /></Suspense>;
}
