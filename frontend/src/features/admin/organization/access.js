import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { ADMIN_CAPABILITIES, ROLE_GROUPS } from '@/shared/constants/roles';
import { userHasCapability } from '@/shared/lib/access';

export const ORGANIZATION_CAPABILITY = 'admin.authority.manage';
export function organizationRouteAccess() {
  return isRustV2ApiMode() ? { roles: [], capabilities: [ORGANIZATION_CAPABILITY], features: ['admin'] }
    : { roles: ROLE_GROUPS.ADMIN_ONLY, capabilities: [ADMIN_CAPABILITIES.ORGANIZATION_MANAGE] };
}
export const canReadOrganization = user => Boolean(userHasCapability(user, ORGANIZATION_CAPABILITY) && user?.accessContext?.features?.includes('admin'));
