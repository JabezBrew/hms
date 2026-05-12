import { useMutation, useQuery } from '@tanstack/react-query'

import { aiAssistantApi } from '@/shared/api/aiAssistant'
import { keyWith } from '@/shared/lib/queryKeys'
import { hashQueryValue } from '@/shared/lib/privateQueryKey'

function normalizeQuery(query) {
  return String(query || '').trim()
}

export function buildOmniTargetHref(targetRoute) {
  const defaultPath = '/patients'
  const path = typeof targetRoute?.path === 'string' ? targetRoute.path.trim() : defaultPath
  const safePath = path.startsWith('/') && !path.startsWith('//') ? path : defaultPath

  const query = targetRoute?.query
  if (!query || typeof query !== 'object') {
    return safePath
  }

  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== null && item !== undefined && item !== '') {
          params.append(key, String(item))
        }
      })
      return
    }
    params.set(key, String(value))
  })

  const queryString = params.toString()
  return queryString ? `${safePath}?${queryString}` : safePath
}

export function formatIntentLabel(intentType) {
  const raw = String(intentType || '').trim()
  if (!raw) return 'Unknown Intent'

  return raw
    .split(/[._-]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

export function useOmniIntentPreview({
  open,
  query,
  mode = 'all',
  enabled = true,
} = {}) {
  const normalized = normalizeQuery(query)
  const shouldFetch =
    Boolean(enabled) &&
    Boolean(open) &&
    mode === 'all' &&
    normalized.length >= 2

  return useQuery({
    queryKey: keyWith('ai', 'omni', 'parse', { q_hash: hashQueryValue(normalized) }),
    queryFn: () => aiAssistantApi.parseOmniIntent({ text: normalized }),
    enabled: shouldFetch,
    staleTime: 15 * 1000,
  })
}

export function useOmniExecutePreview() {
  return useMutation({
    mutationFn: ({ text, intent, context } = {}) =>
      aiAssistantApi.executeOmniPreview({ text, intent, context }),
  })
}
