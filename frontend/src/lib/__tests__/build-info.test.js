import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { formatBuildLabel, getBuildInfo, publishBuildInfo } from '../build-info'

describe('build-info', () => {
  const originalBuildInfo = globalThis.window.__HMS_BUILD_INFO__

  beforeEach(() => {
    globalThis.window.__HMS_BUILD_INFO__ = undefined
  })

  afterEach(() => {
    globalThis.window.__HMS_BUILD_INFO__ = originalBuildInfo
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
})
