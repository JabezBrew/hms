export function userHasCapability(user, capability) {
  if (!user || !capability) {
    return false
  }
  const capabilities = user.adminAccess?.capabilities || user.admin_access?.capabilities || []
  return capabilities.includes(capability)
}

export function userHasAnyCapability(user, capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return false
  }
  return capabilities.some((capability) => userHasCapability(user, capability))
}

export function userHasAnyRole(user, roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    return false
  }
  return roles.includes(user?.role || user?.user_type)
}

export function userCanAccess(user, { roles, capabilities } = {}) {
  const hasRoleRestriction = Array.isArray(roles) && roles.length > 0
  const hasCapabilityRestriction = Array.isArray(capabilities) && capabilities.length > 0

  if (!hasRoleRestriction && !hasCapabilityRestriction) {
    return true
  }

  return userHasAnyRole(user, roles) || userHasAnyCapability(user, capabilities)
}
