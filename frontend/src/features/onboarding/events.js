const FLUSH_DELAY_MS = 750
const MAX_BATCH_SIZE = 25
const MAX_BUFFER_SIZE = 500

let queue = []
let flushTimer = null
let isEnabled = false
let ingestTransport = null
let eventCounter = 0

function getTimerApi() {
  if (typeof window !== 'undefined') {
    return window
  }
  return globalThis
}

function nextEventId() {
  eventCounter = (eventCounter + 1) % 1000000000
  return `${Date.now().toString(36)}-${eventCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function scheduleFlush() {
  if (!isEnabled || !ingestTransport || queue.length === 0 || flushTimer) {
    return
  }
  const timerApi = getTimerApi()
  flushTimer = timerApi.setTimeout(() => {
    void flushQueue()
  }, FLUSH_DELAY_MS)
}

async function flushQueue() {
  const timerApi = getTimerApi()
  if (flushTimer) {
    timerApi.clearTimeout(flushTimer)
    flushTimer = null
  }

  if (!isEnabled || !ingestTransport || queue.length === 0) {
    return
  }

  const batch = queue.slice(0, MAX_BATCH_SIZE)
  queue = queue.slice(batch.length)

  try {
    await ingestTransport(batch)
  } catch {
    queue = [...batch, ...queue].slice(0, MAX_BUFFER_SIZE)
  }

  if (queue.length > 0) {
    scheduleFlush()
  }
}

export function setOnboardingEventEnabled(enabled) {
  isEnabled = Boolean(enabled)
  if (!isEnabled) {
    const timerApi = getTimerApi()
    if (flushTimer) {
      timerApi.clearTimeout(flushTimer)
      flushTimer = null
    }
    return
  }
  scheduleFlush()
}

export function configureOnboardingEventTransport(transport) {
  ingestTransport = typeof transport === 'function' ? transport : null
  if (!ingestTransport) {
    const timerApi = getTimerApi()
    if (flushTimer) {
      timerApi.clearTimeout(flushTimer)
      flushTimer = null
    }
    return
  }
  scheduleFlush()
}

export function emitOnboardingEvent(name, payload = {}) {
  if (!isEnabled || !name) {
    return
  }

  const safePayload =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}

  queue.push({
    event_id: nextEventId(),
    name,
    payload: safePayload,
    ts: new Date().toISOString(),
  })

  if (queue.length > MAX_BUFFER_SIZE) {
    queue = queue.slice(queue.length - MAX_BUFFER_SIZE)
  }

  scheduleFlush()
}

export async function flushOnboardingEvents() {
  await flushQueue()
}
