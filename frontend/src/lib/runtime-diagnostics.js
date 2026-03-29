import { getBuildInfo } from '@/lib/build-info'
import { getRuntimeConfig } from '@/lib/runtime-config'

const UUID_SEGMENT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const NUMERIC_SEGMENT_PATTERN = /^\d{3,}$/
const OPAQUE_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{16,}$/
const CHUNK_ERROR_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /error loading dynamically imported module/i,
]

function normalizeString(value) {
  if (value == null) {
    return null
  }

  const normalized = String(value).trim()
  return normalized || null
}

function sanitizePathSegment(segment) {
  if (!segment) {
    return segment
  }

  if (
    UUID_SEGMENT_PATTERN.test(segment) ||
    NUMERIC_SEGMENT_PATTERN.test(segment) ||
    OPAQUE_SEGMENT_PATTERN.test(segment)
  ) {
    return ':id'
  }

  return segment
}

export function sanitizePathname(pathname = '/') {
  const value = normalizeString(pathname) || '/'
  if (value === '/') {
    return value
  }

  return value
    .split('/')
    .map((segment) => sanitizePathSegment(segment))
    .join('/')
}

function getSearchKeys(search = '') {
  if (!search || search === '?') {
    return []
  }

  const queryString = search.startsWith('?') ? search.slice(1) : search
  return [...new URLSearchParams(queryString).keys()]
}

export function normalizeRuntimeError(errorLike, fallbackMessage = 'Unknown frontend error') {
  if (errorLike instanceof Error) {
    return errorLike
  }

  if (typeof errorLike === 'string') {
    return new Error(errorLike)
  }

  const message =
    normalizeString(errorLike?.message) ||
    normalizeString(errorLike?.reason?.message) ||
    normalizeString(errorLike?.reason) ||
    fallbackMessage

  return new Error(message)
}

export function isChunkLoadError(errorLike) {
  const error = normalizeRuntimeError(errorLike, '')
  const message = `${error.message}\n${error.stack || ''}`.trim()

  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

export function getRuntimeDiagnostics({
  appState = null,
  location = globalThis?.window?.location,
} = {}) {
  return {
    appState: normalizeString(appState),
    build: getBuildInfo(),
    runtime: getRuntimeConfig(),
    location: {
      pathname: sanitizePathname(location?.pathname),
      searchKeys: getSearchKeys(location?.search),
      hasHash: Boolean(location?.hash),
      host: normalizeString(location?.host),
    },
    browser: {
      online: globalThis?.navigator?.onLine ?? true,
      userAgent: normalizeString(globalThis?.navigator?.userAgent),
    },
    capturedAt: new Date().toISOString(),
  }
}

export function publishRuntimeDiagnostics(options = {}) {
  const snapshot = getRuntimeDiagnostics(options)

  if (globalThis?.window) {
    globalThis.window.__HMS_RUNTIME_DIAGNOSTICS__ = snapshot
  }

  return snapshot
}

function getPublishedRuntimeDiagnostics() {
  const candidate = globalThis?.window?.__HMS_RUNTIME_DIAGNOSTICS__
  return candidate && typeof candidate === 'object' ? candidate : null
}

export function formatRuntimeDiagnostics(snapshot = getPublishedRuntimeDiagnostics() ?? getRuntimeDiagnostics()) {
  return JSON.stringify(snapshot, null, 2)
}
