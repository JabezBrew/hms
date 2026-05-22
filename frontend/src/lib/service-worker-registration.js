const STATIC_ASSET_SW_URL = '/hms-static-sw.js'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isSecureServiceWorkerOrigin(locationObject) {
  if (!locationObject) {
    return false
  }
  if (locationObject.protocol === 'https:') {
    return true
  }
  return locationObject.protocol === 'http:' && LOCAL_HOSTS.has(locationObject.hostname)
}

export function canRegisterStaticAssetServiceWorker({
  navigatorObject = globalThis.navigator,
  locationObject = globalThis.location,
  force = false,
} = {}) {
  if (!navigatorObject?.serviceWorker) {
    return false
  }
  if (!isSecureServiceWorkerOrigin(locationObject)) {
    return false
  }
  return force || import.meta.env.PROD
}

export async function registerStaticAssetServiceWorker({
  navigatorObject = globalThis.navigator,
  locationObject = globalThis.location,
  scriptUrl = STATIC_ASSET_SW_URL,
  force = false,
} = {}) {
  if (!canRegisterStaticAssetServiceWorker({ navigatorObject, locationObject, force })) {
    return false
  }

  try {
    return await navigatorObject.serviceWorker.register(scriptUrl, {
      scope: '/',
      updateViaCache: 'none',
    })
  } catch {
    return false
  }
}

export { STATIC_ASSET_SW_URL }
