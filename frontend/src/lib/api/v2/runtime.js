const PLACEHOLDER_PATTERN = /^\$[A-Z0-9_]+$/;
const V2_PATH_PREFIX = '/api/v2';

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
  return envKey ? normalizeString(import.meta.env?.[envKey]) : null;
}

export function isRustV2ApiMode() {
  const mode = getConfigValue('apiMode', 'VITE_HMS_API_MODE');
  return ['rust-v2', 'v2'].includes(String(mode || '').toLowerCase());
}

export function getV2ApiBaseUrl() {
  return (getConfigValue('v2ApiBaseUrl', 'VITE_V2_API_BASE_URL') || V2_PATH_PREFIX).replace(/\/$/, '');
}

export function buildV2ApiUrl(path) {
  const baseUrl = getV2ApiBaseUrl();
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  const pathWithoutPrefix = normalizedPath.startsWith(`${V2_PATH_PREFIX}/`)
    ? normalizedPath.slice(V2_PATH_PREFIX.length)
    : normalizedPath;
  return `${baseUrl}${pathWithoutPrefix}`;
}

export function appendV2QueryParams(url, query = {}) {
  if (!query || typeof query !== 'object') {
    return url;
  }

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          params.append(key, String(item));
        }
      });
      return;
    }
    params.append(key, String(value));
  });

  const queryString = params.toString();
  if (!queryString) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${queryString}`;
}
