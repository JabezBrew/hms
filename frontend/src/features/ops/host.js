const PLACEHOLDER_PATTERN = /^\$[A-Z0-9_]+$/

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeHostList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeHostname).filter(Boolean)
  }

  const normalized = String(value || '').trim()
  if (!normalized || PLACEHOLDER_PATTERN.test(normalized)) {
    return []
  }

  return normalized
    .split(',')
    .map(normalizeHostname)
    .filter(Boolean)
}

function configuredOpsHosts() {
  const runtimeHosts = globalThis.window?.__HMS_RUNTIME_CONFIG__?.opsDashboardHosts
  const envHosts = import.meta.env?.VITE_OPS_DASHBOARD_HOSTS
  const configured = normalizeHostList(runtimeHosts)

  return configured.length > 0 ? configured : normalizeHostList(envHosts)
}

export function isOpsDashboardHost(hostname = globalThis.window?.location?.hostname) {
  const normalized = String(hostname || '').trim().toLowerCase()
  const configuredHosts = configuredOpsHosts()

  if (configuredHosts.length > 0) {
    return configuredHosts.includes(normalized)
  }

  return (
    normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized.startsWith('ops.')
  )
}
