import { hashQueryValue } from './privateQueryKey'

export function getAuthQueryScope({ user, facilityCode } = {}) {
  const context = user?.accessContext || user?.access_context || user || {}
  const sorted = (values) => (Array.isArray(values) ? [...values].sort() : [])
  return hashQueryValue(JSON.stringify({
    user: user?.id || '_anonymous',
    facility: context.facility_id || user?.facility_id || '_unknown',
    facilityCode: String(facilityCode || user?.facilityCode || user?.facility_code || '').trim().toUpperCase(),
    profile: context.active_profile || user?.role || user?.user_type || '_unknown',
    role: user?.role || user?.user_type || '_unknown',
    sessionVersion: context.session_version ?? null,
    permissionVersion: context.permission_version ?? null,
    permissions: sorted(context.permissions || user?.adminAccess?.capabilities || user?.admin_access?.capabilities),
    features: sorted(context.features),
    patientVisibility: sorted(context.patient_visibility),
  }))
}

export function createScopedQueryKey(baseKey, scope) {
  return scope === undefined ? baseKey : [...baseKey, 'scope', scope]
}

export function createKeyFactory(baseKey) {
  const all = [baseKey]
  return {
    all,
    lists: () => [...all, 'list'],
    list: (filters) => [...all, 'list', { filters }],
    details: () => [...all, 'detail'],
    detail: (id) => [...all, 'detail', id],
  }
}

export function keyWith(baseKey, ...parts) {
  return [baseKey, ...parts]
}
