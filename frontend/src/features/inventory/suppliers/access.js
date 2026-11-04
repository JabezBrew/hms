import { userHasCapability } from '@/shared/lib/access';
export const supplierRouteAccess = () => ({ roles: [], capabilities: ['inventory.view'], features: ['inventory'] });
export const canReadSuppliers = user => Boolean(user?.id && user?.accessContext?.facility_id && user?.accessContext?.active_profile
  && userHasCapability(user, 'system.deployment_capabilities.view') && userHasCapability(user, 'inventory.view') && userHasCapability(user, 'patient.demographics.view')
  && user?.accessContext?.features?.includes('inventory') && user?.accessContext?.patient_visibility?.includes('demographics'));
export const canManageSuppliers = user => canReadSuppliers(user) && userHasCapability(user, 'inventory.manage');
