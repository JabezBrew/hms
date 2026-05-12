import { keyWith } from '@/shared/lib/queryKeys'
import { hashQueryValue } from '@/shared/lib/privateQueryKey'

function normalizeTypes(types) {
  if (!Array.isArray(types) || types.length === 0) return null
  return types.filter(Boolean).slice().sort().join(',')
}

export const omniSearchKeys = {
  all: ['omniSearch'],
  results: ({ facilityCode, q, types, limit }) =>
    keyWith('omniSearch', 'results', {
      facilityCode: facilityCode || null,
      q_hash: hashQueryValue(q || ''),
      types: normalizeTypes(types),
      limit: limit ?? null,
    }),
}
