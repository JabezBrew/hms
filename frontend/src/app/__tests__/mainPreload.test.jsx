import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { loadShell } = vi.hoisted(() => ({ loadShell: vi.fn() }))

vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: vi.fn() }) }))
vi.mock('../../App.jsx', () => ({ default: () => null }))
vi.mock('../../lib/build-info.js', () => ({ publishBuildInfo: vi.fn() }))
vi.mock('../../features/ops/host.js', () => ({ isOpsDashboardHost: () => false }))
vi.mock('../AuthenticatedApp.jsx', () => {
  loadShell()
  return { default: () => null }
})

describe('public form shell prefetch', () => {
  let idleCallback

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    loadShell.mockClear()
    idleCallback = null
    window.location.pathname = '/login'
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    vi.stubGlobal('navigator', { connection: {} })
    vi.stubGlobal('requestIdleCallback', vi.fn((callback) => {
      idleCallback = callback
      return 1
    }))
  })

  afterEach(() => {
    window.location.pathname = '/'
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function runBootIdle() {
    await import('../../main.jsx')
    idleCallback()
    // Dynamic import work advances on the real task queue, independently of the
    // delayed post-boot services that this test intentionally leaves pending.
    await vi.advanceTimersByTimeAsync(0)
  }

  it('prefetches the shell from the public login form on a normal connection', async () => {
    await runBootIdle()
    expect(loadShell).toHaveBeenCalledOnce()
  })

  it.each([{ saveData: true }, { effectiveType: 'slow-2g' }, { effectiveType: '2g' }])(
    'skips optional login downloads on a constrained connection: %j',
    async (connection) => {
      navigator.connection = connection
      await runBootIdle()
      expect(loadShell).not.toHaveBeenCalled()
    },
  )

  it('does not prefetch an authenticated shell while the public form is hidden', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await runBootIdle()
    expect(loadShell).not.toHaveBeenCalled()
  })

  it('does not prefetch from unrelated routes', async () => {
    window.location.pathname = '/unavailable'
    await runBootIdle()
    expect(loadShell).not.toHaveBeenCalled()
  })
})
