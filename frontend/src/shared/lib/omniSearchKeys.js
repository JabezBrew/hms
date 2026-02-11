import { keyWith } from '@/shared/lib/queryKeys'

function normalizeTypes(types) {
  if (!Array.isArray(types) || types.length === 0) return null
  return types.filter(Boolean).slice().sort().join(',')
}

export const omniSearchKeys = {
  all: ['omniSearch'],
  results: ({ facilityCode, q, types, limit }) =>
    keyWith('omniSearch', 'results', {
      facilityCode: facilityCode || null,
      q: q || '',
      types: normalizeTypes(types),
      limit: limit ?? null,
    }),
}

