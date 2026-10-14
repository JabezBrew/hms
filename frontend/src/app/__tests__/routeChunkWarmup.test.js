import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleRouteChunkWarmup } from '../routeChunkWarmup'

describe('optional route chunk warmup', () => {
  let callbacks
  let cancel
  let visible

  beforeEach(() => {
    callbacks = new Map()
    visible = 'visible'
    let nextId = 0
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible)
    vi.stubGlobal('navigator', { connection: {} })
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
      callbacks.set(++nextId, callback)
      return nextId
    }))
    vi.stubGlobal('cancelIdleCallback', vi.fn((id) => callbacks.delete(id)))
  })

  afterEach(() => {
    cancel?.()
    cancel = null
    vi.unstubAllGlobals()
  })

  function runIdle() {
    const [id, callback] = callbacks.entries().next().value
    callbacks.delete(id)
    callback()
  }

  it('runs one loader at a time and yields between chunks', async () => {
    let resolveFirst
    const first = vi.fn(() => new Promise((resolve) => { resolveFirst = resolve }))
    const second = vi.fn(() => Promise.resolve())
    const complete = vi.fn()
    cancel = scheduleRouteChunkWarmup([first, second], complete)

    runIdle()
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    expect(callbacks.size).toBe(0)
    resolveFirst()
    await Promise.resolve()
    expect(second).not.toHaveBeenCalled()
    expect(callbacks.size).toBe(1)
    runIdle()
    await Promise.resolve()
    expect(second).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
  })

  it.each([{ saveData: true }, { effectiveType: 'slow-2g' }, { effectiveType: '2g' }])(
    'skips optional downloads for a constrained connection: %j',
    (connection) => {
      navigator.connection = connection
      const load = vi.fn()
      const complete = vi.fn()
      cancel = scheduleRouteChunkWarmup([load], complete)

      expect(callbacks.size).toBe(0)
      expect(load).not.toHaveBeenCalled()
      expect(complete).toHaveBeenCalledOnce()
    },
  )

  it('pauses hidden tabs and resumes when visible', async () => {
    visible = 'hidden'
    const load = vi.fn(() => Promise.resolve())
    cancel = scheduleRouteChunkWarmup([load], vi.fn())
    expect(callbacks.size).toBe(0)

    visible = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(callbacks.size).toBe(1)
    visible = 'hidden'
    runIdle()
    expect(load).not.toHaveBeenCalled()

    visible = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    runIdle()
    await Promise.resolve()
    expect(load).toHaveBeenCalledOnce()
  })

  it('cancels the remaining queue when a session unmounts', async () => {
    let resolveFirst
    const first = vi.fn(() => new Promise((resolve) => { resolveFirst = resolve }))
    const second = vi.fn()
    const complete = vi.fn()
    cancel = scheduleRouteChunkWarmup([first, second], complete)
    runIdle()
    cancel()
    resolveFirst()
    await Promise.resolve()

    expect(callbacks.size).toBe(0)
    expect(second).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('continues after an optional chunk fails', async () => {
    const second = vi.fn(() => Promise.resolve())
    const complete = vi.fn()
    cancel = scheduleRouteChunkWarmup([() => Promise.reject(new Error('synthetic failure')), second], complete)
    runIdle()
    await Promise.resolve()
    runIdle()
    await Promise.resolve()

    expect(second).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
  })

  it('cancels a pending idle turn', () => {
    const load = vi.fn()
    cancel = scheduleRouteChunkWarmup([load], vi.fn())
    expect(callbacks.size).toBe(1)
    cancel()

    expect(callbacks.size).toBe(0)
    expect(load).not.toHaveBeenCalled()
  })
})
