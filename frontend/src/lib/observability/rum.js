import { buildV2ApiUrl, isRustV2ApiMode } from '../api/v2/runtime';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const API_ENDPOINT = '/observability/rum/';
const V2_API_ENDPOINT = '/observability/rum';
const MAX_BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 15000;
const MAX_ROUTE_LENGTH = 120;
const MAX_LABEL_LENGTH = 80;
const DYNAMIC_SEGMENT = ':id';

let initialized = false;
let flushTimer = null;
let queue = [];
let tokenGetter = () => null;
let facilityGetter = () => null;

function readRuntimeConfig() {
  const config = globalThis?.window?.__HMS_RUNTIME_CONFIG__;
  return config && typeof config === 'object' ? config : {};
}

function normalizeBoolean(value) {
  if (value === true) {
    return true;
  }
  if (value === false || value == null) {
    return false;
  }
  return TRUE_VALUES.has(String(value).trim().toLowerCase());
}

export function isRumEnabled() {
  const runtimeConfig = readRuntimeConfig();
  if ('rumEnabled' in runtimeConfig) {
    return normalizeBoolean(runtimeConfig.rumEnabled);
  }
  return normalizeBoolean(import.meta.env?.VITE_RUM_ENABLED);
}

function safeLabel(value, fallback = 'unknown') {
  const text = String(value || '').trim().toLowerCase();
  if (!text || text.length > MAX_LABEL_LENGTH) {
    return fallback;
  }
  return /^[a-z0-9:_./-]+$/.test(text) ? text : fallback;
}

function isDynamicSegment(segment) {
  if (/^\d+$/.test(segment)) {
    return true;
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) {
    return true;
  }
  if (/^(pat|mrn|enc|adm|ord|inv|rx|lab)[-_][a-z0-9-]{4,}$/i.test(segment)) {
    return true;
  }
  if (segment.length >= 10 && /[0-9]/.test(segment) && /[a-z]/i.test(segment)) {
    return true;
  }
  return false;
}

export function scrubRouteLabel(input) {
  let pathname = '/';
  try {
    const parsed = new URL(String(input || '/'), globalThis?.window?.location?.origin || 'http://localhost');
    pathname = parsed.pathname || '/';
  } catch {
    pathname = String(input || '/').split('?')[0].split('#')[0] || '/';
  }

  const segments = pathname
    .split('/')
    .filter(Boolean)
    .slice(0, 8)
    .map((segment) => {
      const decoded = decodeURIComponent(segment).trim();
      if (!decoded || decoded === DYNAMIC_SEGMENT || isDynamicSegment(decoded)) {
        return DYNAMIC_SEGMENT;
      }
      const normalized = decoded.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
      return normalized.length > 32 ? DYNAMIC_SEGMENT : normalized;
    });

  const label = segments.length > 0 ? `/${segments.join('/')}` : '/';
  return label.length > MAX_ROUTE_LENGTH ? '/too-deep' : label;
}

function currentRouteLabel() {
  return scrubRouteLabel(globalThis?.window?.location?.pathname || '/');
}

function enqueue(event) {
  if (!isRumEnabled()) {
    return;
  }
  queue.push({
    ...event,
    ts: Date.now(),
    route: scrubRouteLabel(event.route || currentRouteLabel()),
  });
  if (queue.length >= MAX_BATCH_SIZE) {
    flushRum();
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (flushTimer || typeof globalThis?.setTimeout !== 'function') {
    return;
  }
  flushTimer = globalThis.setTimeout(() => {
    flushTimer = null;
    flushRum();
  }, FLUSH_INTERVAL_MS);
}

function apiBaseUrl() {
  const runtimeConfig = readRuntimeConfig();
  const configured = runtimeConfig.apiBaseUrl || import.meta.env?.VITE_API_BASE_URL || '/api';
  return String(configured).replace(/\/$/, '');
}

function rumUrl() {
  if (isRustV2ApiMode()) {
    return buildV2ApiUrl(V2_API_ENDPOINT);
  }
  return `${apiBaseUrl()}${API_ENDPOINT}`;
}

function buildPayload(events) {
  return JSON.stringify({
    events: events.map((event) => ({
      type: safeLabel(event.type),
      name: safeLabel(event.name),
      route: scrubRouteLabel(event.route),
      value: Number.isFinite(event.value) ? Math.max(0, Math.round(event.value)) : 0,
      status: event.status == null ? undefined : safeLabel(event.status),
      method: event.method == null ? undefined : safeLabel(event.method),
      ts: Number.isFinite(event.ts) ? Math.floor(event.ts) : Date.now(),
    })),
  });
}

export function configureRumAuth({ getAccessToken, getFacilityCode } = {}) {
  if (typeof getAccessToken === 'function') {
    tokenGetter = getAccessToken;
  }
  if (typeof getFacilityCode === 'function') {
    facilityGetter = getFacilityCode;
  }
}

export function flushRum() {
  if (!queue.length || !isRumEnabled()) {
    return false;
  }

  const events = queue.splice(0, MAX_BATCH_SIZE);
  const body = buildPayload(events);
  const token = tokenGetter();
  const facility = facilityGetter();

  try {
    if (!token && globalThis?.navigator?.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (globalThis.navigator.sendBeacon(rumUrl(), blob)) {
        return true;
      }
    }

    if (typeof globalThis?.fetch === 'function') {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      if (facility) {
        headers['X-Facility-Code'] = facility;
      }
      globalThis.fetch(rumUrl(), {
        method: 'POST',
        body,
        headers,
        credentials: 'include',
        keepalive: true,
      }).catch(() => {});
      return true;
    }
  } catch {
    // RUM must never affect the application path.
  }

  return false;
}

function observeEntryType(type, callback) {
  if (typeof globalThis?.PerformanceObserver !== 'function') {
    return;
  }
  try {
    const supported = PerformanceObserver.supportedEntryTypes || [];
    if (supported.length && !supported.includes(type)) {
      return;
    }
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach(callback);
    });
    observer.observe({ type, buffered: true });
  } catch {
    // Unsupported observers vary by browser.
  }
}

function collectNavigationTiming() {
  const navigation = globalThis?.performance?.getEntriesByType?.('navigation')?.[0];
  if (!navigation) {
    return;
  }
  enqueue({ type: 'navigation', name: 'load', value: navigation.loadEventEnd || navigation.duration });
  enqueue({ type: 'navigation', name: 'dom-content-loaded', value: navigation.domContentLoadedEventEnd });
  enqueue({ type: 'navigation', name: 'ttfb', value: navigation.responseStart });
}

export function initBrowserRum() {
  if (initialized || !isRumEnabled()) {
    return false;
  }
  initialized = true;

  if (globalThis?.document?.readyState === 'complete') {
    collectNavigationTiming();
  } else {
    globalThis?.window?.addEventListener?.('load', collectNavigationTiming, { once: true });
  }
  observeEntryType('largest-contentful-paint', (entry) => {
    enqueue({ type: 'web-vital', name: 'lcp', value: entry.startTime });
  });
  observeEntryType('layout-shift', (entry) => {
    if (!entry.hadRecentInput) {
      enqueue({ type: 'web-vital', name: 'cls', value: Math.round((entry.value || 0) * 1000) });
    }
  });
  observeEntryType('first-input', (entry) => {
    enqueue({ type: 'web-vital', name: 'fid', value: entry.processingStart - entry.startTime });
  });
  observeEntryType('event', (entry) => {
    if (entry.name === 'click' || entry.name === 'keydown' || entry.interactionId) {
      enqueue({ type: 'web-vital', name: 'inp', value: entry.duration });
    }
  });

  globalThis?.window?.addEventListener?.('pagehide', () => flushRum());
  globalThis?.window?.addEventListener?.('visibilitychange', () => {
    if (globalThis.document?.visibilityState === 'hidden') {
      flushRum();
    }
  });

  return true;
}

export function recordApiTiming({ endpoint, method, durationMs, status }) {
  if (!isRumEnabled()) {
    return;
  }
  enqueue({
    type: 'api',
    name: 'duration',
    route: scrubRouteLabel(endpoint),
    method: String(method || 'GET').toLowerCase(),
    status: status == null ? 'network' : String(status),
    value: durationMs,
  });
}

export function __resetRumForTests() {
  initialized = false;
  queue = [];
  tokenGetter = () => null;
  facilityGetter = () => null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}
