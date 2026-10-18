import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { ROLE_GROUPS } from '@/shared/constants/roles';
import { userHasCapability } from '@/shared/lib/access';
export const storageLocationRouteAccess = () => isRustV2ApiMode() ? { roles: [], capabilities: ['inventory.view'], features: ['inventory'] } : { roles: ROLE_GROUPS.INVENTORY };
export const storageLocationParentAccess = () => isRustV2ApiMode() ? { roles: ROLE_GROUPS.INVENTORY, capabilities: ['inventory.view'] } : { roles: ROLE_GROUPS.INVENTORY };
export const canReadLocations = user => Boolean(userHasCapability(user, 'inventory.view') && userHasCapability(user, 'patient.demographics.view') && user?.accessContext?.features?.includes('inventory') && user?.accessContext?.patient_visibility?.includes('demographics'));
export const canManageLocations = user => canReadLocations(user) && userHasCapability(user, 'inventory.manage');
