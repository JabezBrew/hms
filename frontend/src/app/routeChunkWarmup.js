export function hasConstrainedConnection() {
  const connection = globalThis.navigator?.connection
  return connection?.saveData === true || ['slow-2g', '2g'].includes(connection?.effectiveType)
}

function scheduleIdle(callback) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: 1200 })
    return () => window.cancelIdleCallback(id)
  }

  const id = window.setTimeout(callback, 800)
  return () => window.clearTimeout(id)
}

/** Warm optional chunks one idle turn at a time without competing with hidden tabs. */
export function scheduleRouteChunkWarmup(loaders, onComplete) {
  let cancelled = false
  let loading = false
  let nextIndex = 0
  let cancelIdle = null

  const cleanUp = () => {
    cancelIdle?.()
    cancelIdle = null
    document.removeEventListener('visibilitychange', resume)
  }

  const finish = () => {
    cleanUp()
    if (!cancelled) onComplete()
  }

  const runNext = async () => {
    cancelIdle = null
    if (cancelled || document.visibilityState === 'hidden') return
    if (hasConstrainedConnection() || nextIndex >= loaders.length) {
      finish()
      return
    }

    loading = true
    try {
      await loaders[nextIndex++]()
    } catch {
      // Optional prefetch failures must not prevent navigation from retrying.
    } finally {
      loading = false
    }

    if (!cancelled) resume()
  }

  function resume() {
    if (cancelled || loading || cancelIdle) return
    if (hasConstrainedConnection() || nextIndex >= loaders.length) {
      finish()
      return
    }
    if (document.visibilityState !== 'hidden') {
      cancelIdle = scheduleIdle(() => { void runNext() })
    }
  }

  document.addEventListener('visibilitychange', resume)
  resume()

  return () => {
    cancelled = true
    cleanUp()
  }
}
