const PLACEHOLDER_PATTERN = /^\$[A-Z0-9_]+$/;
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function normalizeString(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized || PLACEHOLDER_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function getWindowRuntimeConfig() {
  const candidate = globalThis?.window?.__HMS_RUNTIME_CONFIG__;
  return candidate && typeof candidate === 'object' ? candidate : {};
}

function getConfigValue(runtimeKey, envKey = null) {
  const runtimeValue = normalizeString(getWindowRuntimeConfig()?.[runtimeKey]);
  if (runtimeValue !== null) {
    return runtimeValue;
  }

  if (!envKey) {
    return null;
  }

  return normalizeString(import.meta.env?.[envKey]);
}

export function getApiBaseUrl() {
  const configured = getConfigValue('apiBaseUrl', 'VITE_API_BASE_URL');
  return (configured ?? '/api').replace(/\/$/, '');
}

export function getApiBasePathname() {
  const apiBaseUrl = getApiBaseUrl();

  if (/^https?:\/\//i.test(apiBaseUrl)) {
    try {
      return new URL(apiBaseUrl).pathname.replace(/\/$/, '') || '/';
    } catch {
      return '/api';
    }
  }

  return apiBaseUrl.startsWith('/') ? apiBaseUrl : `/${apiBaseUrl}`;
}

export function getWebSocketBaseUrl() {
  const explicit = getConfigValue('wsUrl', 'VITE_WS_URL');
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const apiBaseUrl = getApiBaseUrl();
  if (/^https?:\/\//i.test(apiBaseUrl)) {
    try {
      const parsed = new URL(apiBaseUrl);
      parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      parsed.pathname = parsed.pathname.replace(/\/api\/?$/i, '');
      return parsed.toString().replace(/\/$/, '');
    } catch {
      // Fall through to environment defaults.
    }
  }

  if (import.meta.env.DEV) {
    return 'ws://localhost:8000';
  }

  const location = globalThis?.window?.location;
  if (location?.host) {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}`;
  }

  return 'ws://localhost:8000';
}

export function getDefaultFacilityCode() {
  const facilityCode = getConfigValue('defaultFacilityCode', 'VITE_DEFAULT_FACILITY_CODE');
  return facilityCode ? facilityCode.toUpperCase() : null;
}

export function isMultiFacilityModeEnabled() {
  const configured = getConfigValue('multiFacilityMode', 'VITE_MULTI_FACILITY_MODE');
  return configured ? TRUE_VALUES.has(configured.toLowerCase()) : false;
}

export function getRuntimeConfig() {
  return {
    apiBaseUrl: getApiBaseUrl(),
    apiBasePathname: getApiBasePathname(),
    wsUrl: getWebSocketBaseUrl(),
    defaultFacilityCode: getDefaultFacilityCode(),
    multiFacilityMode: isMultiFacilityModeEnabled(),
  };
}
