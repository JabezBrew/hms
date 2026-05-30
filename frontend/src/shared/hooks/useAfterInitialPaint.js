import { useEffect, useState } from 'react'

export function useAfterInitialPaint({
  enabled = true,
  minimumDelayMs = 80,
  timeoutMs = 400,
} = {}) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setReady(false)
      return undefined
    }

    if (typeof window === 'undefined') {
      setReady(true)
      return undefined
    }

    let cancelled = false
    let frameId = 0
    let delayId = 0
    let idleId = 0

    const markReady = () => {
      if (!cancelled) {
        setReady(true)
      }
    }

    const scheduleIdle = () => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(markReady, { timeout: timeoutMs })
        return
      }
      delayId = window.setTimeout(markReady, Math.min(timeoutMs, 120))
    }

    setReady(false)
    frameId = window.requestAnimationFrame(() => {
      delayId = window.setTimeout(scheduleIdle, minimumDelayMs)
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(delayId)
      if (idleId && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [enabled, minimumDelayMs, timeoutMs])

  return enabled && ready
}
