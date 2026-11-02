import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { formatBuildLabel, getBuildInfo, publishBuildInfo } from '../build-info'

describe('build-info', () => {
  const originalBuildInfo = globalThis.window.__HMS_BUILD_INFO__
  const originalStaticBuildInfo = globalThis.__HMS_STATIC_BUILD_INFO__

  beforeEach(() => {
    globalThis.window.__HMS_BUILD_INFO__ = undefined
    globalThis.__HMS_STATIC_BUILD_INFO__ = undefined
  })

  afterEach(() => {
    globalThis.window.__HMS_BUILD_INFO__ = originalBuildInfo
    globalThis.__HMS_STATIC_BUILD_INFO__ = originalStaticBuildInfo
  })

  it('falls back to a safe default build version when no metadata is present', () => {
    expect(getBuildInfo()).toMatchObject({
      version: '0.0.0',
    })
  })

  it('publishes and formats normalized build metadata', () => {
    globalThis.window.__HMS_BUILD_INFO__ = {
      version: '1.4.2',
      commit: 'abc1234',
      branch: 'main',
      builtAt: '2026-03-29T19:55:00.000Z',
      mode: 'production',
    }

    expect(publishBuildInfo()).toEqual({
      version: '1.4.2',
      commit: 'abc1234',
      branch: 'main',
      builtAt: '2026-03-29T19:55:00.000Z',
      mode: 'production',
    })
    expect(formatBuildLabel()).toBe('1.4.2 (abc1234)')
  })

  it('preserves the complete release identity from the built application', () => {
    const commit = 'ac92aaae6d0c015e20e2b5eafb6fa0c38a2cbd8a'
    globalThis.__HMS_STATIC_BUILD_INFO__ = {
      version: '0.1.0', commit, branch: null,
      builtAt: '2026-11-02T00:00:00.000Z', mode: 'production',
    }

    expect(publishBuildInfo().commit).toBe(commit)
    expect(globalThis.window.__HMS_BUILD_INFO__.commit).toBe(commit)
  })
})
