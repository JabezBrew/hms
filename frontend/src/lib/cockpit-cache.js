import { getBuildInfo } from './build-info'

const DB_NAME = 'hms-cockpit-cache'
const DB_VERSION = 1
const STORE_NAME = 'entries'
const SCOPE_SEPARATOR = '|'

export const COCKPIT_CACHE_DEFAULT_TTL_MS = 6 * 60 * 60 * 1000
export const COCKPIT_CACHE_MAX_BYTES = 2 * 1024 * 1024

export const COCKPIT_CACHE_CATEGORIES = Object.freeze({
  COMMAND_REGISTRY: 'command_registry',
  ACTION_REGISTRY: 'action_registry',
  ROUTE_MANIFEST: 'route_manifest',
  FEATURE_METADATA: 'feature_metadata',
  CONFIG_METADATA: 'config_metadata',
  UI_PREFERENCES: 'ui_preferences',
  STATIC_CATALOG: 'static_catalog',
})

const ALLOWED_CATEGORIES = new Set(Object.values(COCKPIT_CACHE_CATEGORIES))
const TRUE_NON_PHI_MARKERS = new Set(['non-phi', 'non_phi', 'safe-static', 'safe_static'])
const FORBIDDEN_FIELD_KEYS = new Set([
  'admission',
  'admissionid',
  'address',
  'allergies',
  'allergy',
  'birthdate',
  'chartentry',
  'clinicalnote',
  'condition',
  'dateofbirth',
  'diagnosis',
  'diagnoses',
  'dob',
  'email',
  'encounter',
  'encounterid',
  'insuranceid',
  'labresult',
  'labresults',
  'medicalrecordnumber',
  'medication',
  'medications',
  'mrn',
  'nationalid',
  'note',
  'notes',
  'notetext',
  'observation',
  'patient',
  'patientid',
  'patientidentifier',
  'patientname',
  'patients',
  'phone',
  'prescription',
  'prescriptions',
  'telephone',
  'vital',
  'vitals',
])

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
const CLINICAL_IDENTIFIER_PATTERN = /\b(?:MRN|PAT|ENC|ADM|LAB|RX|INV)[-_ ]?[A-Z0-9]{4,}\b/i
const API_CLINICAL_PATH_PATTERN = /\/api\/v?\d*\/(?:patients|encounters|admissions|clinical|charts|laboratory|pharmacy|nursing|wards)\b/i
const FHIR_RESOURCE_TYPES = new Set([
  'allergyintolerance',
  'condition',
  'diagnosticreport',
  'encounter',
  'medicationrequest',
  'observation',
  'patient',
  'procedure',
])

let dbPromise = null
let testAdapter = null
let telemetryHook = null

export class CockpitCacheSecurityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CockpitCacheSecurityError'
  }
}

function normalizeFieldKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeScopePart(value, fallback) {
  const text = value == null ? '' : String(value).trim()
  return text || fallback
}

function assertSafeScopePart(name, value) {
  if (EMAIL_PATTERN.test(String(value))) {
    throw new CockpitCacheSecurityError(`Cockpit cache ${name} must not contain email addresses`)
  }
}

function encodeScopePart(value) {
  return encodeURIComponent(String(value))
}

function currentDeploymentVersion() {
  const buildInfo = getBuildInfo()
  return buildInfo.commit || buildInfo.version || 'dev'
}

export function createCockpitCacheScope({
  deploymentVersion = currentDeploymentVersion(),
  userId = '_anonymous',
  facilityCode = '_unknown',
} = {}) {
  const scope = {
    deploymentVersion: normalizeScopePart(deploymentVersion, 'dev'),
    userId: normalizeScopePart(userId, '_anonymous'),
    facilityCode: normalizeScopePart(facilityCode, '_unknown').toUpperCase(),
  }

  assertSafeScopePart('userId', scope.userId)
  assertSafeScopePart('facilityCode', scope.facilityCode)

  return {
    ...scope,
    scopeKey: [
      scope.deploymentVersion,
      scope.userId,
      scope.facilityCode,
    ].map(encodeScopePart).join(SCOPE_SEPARATOR),
  }
}

function cacheEntryId(scope, category, key) {
  return [
    scope.scopeKey,
    encodeScopePart(category),
    encodeScopePart(key),
  ].join(SCOPE_SEPARATOR)
}

function byteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length
  }
  return text.length
}

function assertJsonSerializable(value) {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw new Error('Value is not JSON serializable')
    }
    return serialized
  } catch (error) {
    throw new CockpitCacheSecurityError(`Cockpit cache value must be JSON serializable: ${error.message}`)
  }
}

function isStaticCatalogMarkedNonPhi(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const marker = value.nonPhi ?? value.non_phi ?? value?.metadata?.nonPhi ?? value?.metadata?.classification
  return marker === true || TRUE_NON_PHI_MARKERS.has(String(marker).toLowerCase())
}

function findPhiRisk(value, path = '$', seen = new WeakSet()) {
  if (value == null) {
    return null
  }

  if (typeof value === 'string') {
    if (EMAIL_PATTERN.test(value)) {
      return `${path} contains an email address`
    }
    if (UUID_PATTERN.test(value)) {
      return `${path} contains a UUID-like identifier`
    }
    if (CLINICAL_IDENTIFIER_PATTERN.test(value)) {
      return `${path} contains a clinical identifier`
    }
    if (API_CLINICAL_PATH_PATTERN.test(value)) {
      return `${path} contains a clinical API path`
    }
    return null
  }

  if (typeof value !== 'object') {
    return null
  }

  if (seen.has(value)) {
    return null
  }
  seen.add(value)

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const risk = findPhiRisk(value[index], `${path}[${index}]`, seen)
      if (risk) {
        return risk
      }
    }
    return null
  }

  const resourceType = value.resourceType == null ? null : String(value.resourceType).toLowerCase()
  if (resourceType && FHIR_RESOURCE_TYPES.has(resourceType)) {
    return `${path}.resourceType contains a FHIR clinical resource`
  }

  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = normalizeFieldKey(key)
    const childPath = `${path}.${key}`
    if (FORBIDDEN_FIELD_KEYS.has(normalizedKey)) {
      return `${childPath} uses a PHI-bearing field name`
    }

    const risk = findPhiRisk(childValue, childPath, seen)
    if (risk) {
      return risk
    }
  }

  return null
}

export function assertNonPhiCockpitCacheValue(category, key, value, { nonPhi = false } = {}) {
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new CockpitCacheSecurityError(`Unsupported cockpit cache category: ${category}`)
  }
  if (nonPhi !== true) {
    throw new CockpitCacheSecurityError('Cockpit cache writes must be explicitly marked non-PHI')
  }
  if (category === COCKPIT_CACHE_CATEGORIES.STATIC_CATALOG && !isStaticCatalogMarkedNonPhi(value)) {
    throw new CockpitCacheSecurityError('Static catalogs must carry an explicit non-PHI marker')
  }

  const keyRisk = findPhiRisk(String(key), '$.key')
  if (keyRisk) {
    throw new CockpitCacheSecurityError(keyRisk)
  }

  const valueRisk = findPhiRisk(value)
  if (valueRisk) {
    throw new CockpitCacheSecurityError(valueRisk)
  }
}

function createIndexedDbAdapter() {
  return {
    async getRecord(id) {
      const db = await openCockpitDb()
      return requestToPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id))
    },
    async putRecord(record) {
      const db = await openCockpitDb()
      await requestToPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record))
    },
    async deleteRecord(id) {
      const db = await openCockpitDb()
      await requestToPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id))
    },
    async listRecords() {
      const db = await openCockpitDb()
      return requestToPromise(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll())
    },
    async clearRecords() {
      const db = await openCockpitDb()
      await requestToPromise(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear())
    },
  }
}

const indexedDbAdapter = createIndexedDbAdapter()

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function ensureIndex(store, name, keyPath) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath)
  }
}

function openCockpitDb() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('IndexedDB is unavailable'))
  }
  if (dbPromise) {
    return dbPromise
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'id' })

      ensureIndex(store, 'scopeKey', 'scopeKey')
      ensureIndex(store, 'deploymentVersion', 'deploymentVersion')
      ensureIndex(store, 'userId', 'userId')
      ensureIndex(store, 'facilityCode', 'facilityCode')
      ensureIndex(store, 'accessedAt', 'accessedAt')
      ensureIndex(store, 'expiresAt', 'expiresAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      dbPromise = null
      reject(request.error || new Error('Failed to open cockpit cache IndexedDB'))
    }
    request.onblocked = () => {
      dbPromise = null
      reject(new Error('Cockpit cache IndexedDB upgrade is blocked'))
    }
  })

  return dbPromise
}

function getActiveAdapter() {
  if (testAdapter) {
    return testAdapter
  }
  if (!globalThis.indexedDB) {
    return null
  }
  return indexedDbAdapter
}

async function deleteRecordsWhere(predicate) {
  const adapter = getActiveAdapter()
  if (!adapter) {
    return false
  }

  const records = await adapter.listRecords()
  await Promise.all(records.filter(predicate).map((record) => adapter.deleteRecord(record.id)))
  return true
}

async function enforceStorageBudget(adapter, budgetBytes, now) {
  const records = await adapter.listRecords()
  let totalBytes = 0
  const activeRecords = []

  const expiredRecords = []
  for (const record of records) {
    if (record.expiresAt <= now) {
      expiredRecords.push(record)
    } else {
      totalBytes += record.sizeBytes || 0
      activeRecords.push(record)
    }
  }
  const recordsToDelete = [...expiredRecords]

  if (totalBytes > budgetBytes) {
    activeRecords.sort((left, right) => (left.accessedAt || 0) - (right.accessedAt || 0))
    for (const record of activeRecords) {
      recordsToDelete.push(record)
      totalBytes -= record.sizeBytes || 0
      if (totalBytes <= budgetBytes) {
        break
      }
    }
  }

  await Promise.all(recordsToDelete.map((record) => adapter.deleteRecord(record.id)))
}

function safeReason(reason) {
  return String(reason || 'unknown').toLowerCase().replace(/[^a-z0-9:_-]/g, '_').slice(0, 60)
}

export function setCockpitCacheTelemetryHook(handler) {
  telemetryHook = typeof handler === 'function' ? handler : null
}

export async function estimateCockpitStorage(reason = 'manual', scope = null) {
  if (!telemetryHook || !globalThis.navigator?.storage?.estimate) {
    return null
  }

  try {
    const estimate = await globalThis.navigator.storage.estimate()
    const usageBytes = Number.isFinite(estimate?.usage) ? estimate.usage : 0
    const quotaBytes = Number.isFinite(estimate?.quota) ? estimate.quota : 0
    const event = {
      name: 'cockpit_cache.storage_estimate',
      reason: safeReason(reason),
      usageBytes,
      quotaBytes,
      usageRatio: quotaBytes > 0 ? usageBytes / quotaBytes : 0,
      deploymentVersion: scope?.deploymentVersion || '_unknown',
      facilitySafe: scope?.facilityCode || '_unknown',
      userScoped: Boolean(scope?.userId && scope.userId !== '_anonymous'),
    }
    telemetryHook(event)
    return event
  } catch {
    return null
  }
}

export async function putCockpitCacheEntry(scopeInput, category, key, value, options = {}) {
  const scope = createCockpitCacheScope(scopeInput)
  const nonPhi = options.nonPhi === true
  assertNonPhiCockpitCacheValue(category, key, value, { nonPhi })

  const serialized = assertJsonSerializable(value)
  const sizeBytes = byteLength(serialized) + byteLength(String(key)) + byteLength(category)
  const maxBytes = options.maxBytes || COCKPIT_CACHE_MAX_BYTES

  if (sizeBytes > maxBytes) {
    throw new Error('Cockpit cache entry exceeds the configured storage budget')
  }

  const adapter = getActiveAdapter()
  if (!adapter) {
    return false
  }

  const now = Date.now()
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(1, options.ttlMs) : COCKPIT_CACHE_DEFAULT_TTL_MS
  const record = {
    id: cacheEntryId(scope, category, key),
    scopeKey: scope.scopeKey,
    deploymentVersion: scope.deploymentVersion,
    userId: scope.userId,
    facilityCode: scope.facilityCode,
    category,
    key: String(key),
    value: JSON.parse(serialized),
    createdAt: now,
    accessedAt: now,
    expiresAt: now + ttlMs,
    sizeBytes,
    nonPhi: true,
  }

  await adapter.putRecord(record)
  await enforceStorageBudget(adapter, maxBytes, now)
  void estimateCockpitStorage('write', scope)
  return true
}

export async function getCockpitCacheEntry(scopeInput, category, key) {
  if (!ALLOWED_CATEGORIES.has(category)) {
    throw new CockpitCacheSecurityError(`Unsupported cockpit cache category: ${category}`)
  }

  const adapter = getActiveAdapter()
  if (!adapter) {
    return null
  }

  const scope = createCockpitCacheScope(scopeInput)
  const id = cacheEntryId(scope, category, key)
  const record = await adapter.getRecord(id)
  if (!record) {
    return null
  }

  const now = Date.now()
  if (record.expiresAt <= now) {
    await adapter.deleteRecord(id)
    return null
  }

  await adapter.putRecord({ ...record, accessedAt: now })
  return record.value
}

export async function deleteCockpitCacheEntry(scopeInput, category, key) {
  const adapter = getActiveAdapter()
  if (!adapter) {
    return false
  }
  const scope = createCockpitCacheScope(scopeInput)
  await adapter.deleteRecord(cacheEntryId(scope, category, key))
  return true
}

export async function clearCockpitCacheScope(scopeInput) {
  const scope = createCockpitCacheScope(scopeInput)
  const cleared = await deleteRecordsWhere((record) => record.scopeKey === scope.scopeKey)
  void estimateCockpitStorage('clear_scope', scope)
  return cleared
}

export async function clearCockpitCacheForUser({ userId, facilityCode } = {}) {
  const normalizedUserId = userId == null ? null : String(userId)
  const normalizedFacilityCode = facilityCode == null ? null : String(facilityCode).toUpperCase()

  const cleared = await deleteRecordsWhere((record) => {
    if (normalizedUserId && record.userId !== normalizedUserId) {
      return false
    }
    if (normalizedFacilityCode && record.facilityCode !== normalizedFacilityCode) {
      return false
    }
    return true
  })
  void estimateCockpitStorage('clear_user')
  return cleared
}

export async function clearAllCockpitCaches({ reason = 'clear_all' } = {}) {
  const adapter = getActiveAdapter()
  if (!adapter) {
    return false
  }
  await adapter.clearRecords()
  void estimateCockpitStorage(reason)
  return true
}

export function __setCockpitCacheAdapterForTests(adapter) {
  testAdapter = adapter || null
}

export function __resetCockpitCacheForTests() {
  testAdapter = null
  telemetryHook = null
  dbPromise = null
}
