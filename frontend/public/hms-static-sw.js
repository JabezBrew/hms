const HMS_STATIC_CACHE_PREFIX = 'hms-static-assets'
const HMS_STATIC_CACHE_NAME = `${HMS_STATIC_CACHE_PREFIX}-v1`
const HASHED_ASSET_PATTERN = /^\/assets\/[^?#/]+[-.][a-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|svg|png|webp|ico)$/i
const ICON_ASSET_PATTERN = /^\/(?:favicon(?:-\d+x\d+)?\.(?:svg|png|ico)|apple-touch-icon\.png|mask-icon\.svg)$/i
const CACHEABLE_DESTINATIONS = new Set(['script', 'style', 'font', 'image'])

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isCacheableStaticPath(pathname) {
  return HASHED_ASSET_PATTERN.test(pathname) || ICON_ASSET_PATTERN.test(pathname)
}

function isCacheableStaticRequest(request) {
  if (!request || request.method !== 'GET') {
    return false
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return false
  }
  if (isApiPath(url.pathname)) {
    return false
  }
  if (!isCacheableStaticPath(url.pathname)) {
    return false
  }
  if (request.mode === 'navigate') {
    return false
  }
  if (request.destination && !CACHEABLE_DESTINATIONS.has(request.destination)) {
    return false
  }

  return true
}

function isCacheableStaticResponse(response) {
  if (!response || !response.ok) {
    return false
  }
  return response.type === 'basic' || response.type === 'cors' || response.type === 'default'
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith(HMS_STATIC_CACHE_PREFIX) && key !== HMS_STATIC_CACHE_NAME)
        .map((key) => caches.delete(key))
    )
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  if (!isCacheableStaticRequest(event.request)) {
    return
  }

  event.respondWith((async () => {
    const cache = await caches.open(HMS_STATIC_CACHE_NAME)
    const cached = await cache.match(event.request)
    if (cached) {
      return cached
    }

    const response = await fetch(event.request)
    if (isCacheableStaticResponse(response)) {
      await cache.put(event.request, response.clone())
    }
    return response
  })())
})
