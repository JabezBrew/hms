import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { ROLE_GROUPS } from '@/shared/constants/roles';
import { userHasCapability } from '@/shared/lib/access';
export const bookableServiceRouteAccess = () => isRustV2ApiMode() ? { roles: [], capabilities: ['appointment.view'], features: ['appointments'] } : { roles: ROLE_GROUPS.APPOINTMENTS };
export const canReadServices = user => Boolean(userHasCapability(user, 'appointment.view') && userHasCapability(user, 'patient.demographics.view') && user?.accessContext?.features?.includes('appointments') && user?.accessContext?.patient_visibility?.includes('demographics'));
export const canManageServices = user => canReadServices(user) && userHasCapability(user, 'appointment.manage');
