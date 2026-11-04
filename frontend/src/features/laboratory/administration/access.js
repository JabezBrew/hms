import { userHasCapability } from '@/shared/lib/access';
export const catalogRouteAccess = () => ({ roles: [], capabilities: ['laboratory.catalog.manage'] });
// An ordinary facility manager is intentionally independent of patient access,
// ordering/verification, deployment-admin grants and role labels.
export const canReadCatalogAdministration = user => Boolean(user?.id && user?.accessContext?.facility_id && user?.accessContext?.active_profile
  && userHasCapability(user, 'laboratory.catalog.manage') && user.accessContext.features?.includes('laboratory'));

export const isCatalogAdministrationPath = path => path === '/laboratory/catalog-administration' || path.startsWith('/laboratory/catalog-administration/');
