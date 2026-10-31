import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { ROLE_GROUPS } from '@/shared/constants/roles';
import { userHasAnyCapability } from '@/shared/lib/access';
// Match the existing server list purpose, independently of the narrower form.
export const TRANSFER_READ_CAPABILITIES = Object.freeze(['inventory.view', 'inventory.manage', 'pharmacy.dispense', 'controlled_substance.manage']);
const LIST_FEATURES = new Set(['inventory', 'pharmacy']);
const features = user => Array.isArray(user?.accessContext?.features) ? user.accessContext.features : [];
export const canReadTransferList = user => Boolean(user?.id && user?.accessContext?.facility_id && userHasAnyCapability(user, TRANSFER_READ_CAPABILITIES)
  && features(user).some(feature => LIST_FEATURES.has(feature)) && user?.accessContext?.patient_visibility?.includes('demographics'));
// FeatureBasedRoute expresses ALL requirements; the wrapper checks the actual
// Inventory OR Pharmacy list purpose without changing that shared contract.
export const transferRouteAccess = () => isRustV2ApiMode() ? { roles: [], capabilities: TRANSFER_READ_CAPABILITIES } : { roles: ROLE_GROUPS.INVENTORY };
export const transferNavigationFeatures = ({ enabledFeatures }) => isRustV2ApiMode() && enabledFeatures?.inventory !== true ? ['pharmacy'] : ['inventory'];
export const transferNavigationHref = ({ user, enabledFeatures }) => !isRustV2ApiMode() || (canReadTransferList(user) && features(user).some(feature => LIST_FEATURES.has(feature) && enabledFeatures?.[feature] === true)) ? '/inventory/transfers' : null;
