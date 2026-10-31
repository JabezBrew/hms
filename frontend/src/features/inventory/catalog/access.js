import { userHasCapability } from '@/shared/lib/access';
export const catalogRouteAccess = () => ({ roles: [], capabilities: ['inventory.view'], features: ['inventory'] });
export const canReadCatalog = user => Boolean(userHasCapability(user, 'inventory.view') && userHasCapability(user, 'patient.demographics.view')
  && user?.accessContext?.features?.includes('inventory') && user?.accessContext?.patient_visibility?.includes('demographics'));
// This is UI availability; backend command permission remains its independent
// InventoryManage policy. The normal deployment-capability read grants no role.
export const canManageCatalog = user => canReadCatalog(user) && userHasCapability(user, 'inventory.manage');
