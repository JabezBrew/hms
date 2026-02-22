import { describe, expect, it } from 'vitest'

import { buildOmniTargetHref, formatIntentLabel } from '@/shared/hooks/useOmniIntentPreview'

describe('useOmniIntentPreview helpers', () => {
  it('builds a safe target href with query params', () => {
    const href = buildOmniTargetHref({
      path: '/laboratory/results',
      query: { q: 'john doe', status: 'critical' },
    })

    expect(href).toContain('/laboratory/results?')
    expect(href).toContain('q=john+doe')
    expect(href).toContain('status=critical')
  })

  it('falls back to /patients for invalid paths', () => {
    const href = buildOmniTargetHref({
      path: 'http://malicious.example',
      query: { q: 'alpha' },
    })

    expect(href).toBe('/patients?q=alpha')
  })

  it('falls back to /patients for protocol-relative paths', () => {
    const href = buildOmniTargetHref({
      path: '//malicious.example',
      query: { q: 'alpha' },
    })

    expect(href).toBe('/patients?q=alpha')
  })

  it('formats intent type labels for display', () => {
    expect(formatIntentLabel('navigate.laboratory.results')).toBe('Navigate Laboratory Results')
    expect(formatIntentLabel('')).toBe('Unknown Intent')
  })
})
