import { useQuery } from '@tanstack/react-query'

import { omniSearchApi } from '@/shared/api/omniSearch'
import { omniSearchKeys } from '@/shared/lib/omniSearchKeys'

function normalizeQuery(q) {
  return (q ?? '').trim()
}

export function useOmniSearchResults({
  open,
  facilityCode,
  q,
  types,
  limit = 8,
  enabled = true,
} = {}) {
  const query = normalizeQuery(q)
  const effectiveTypes = Array.isArray(types) ? types.filter(Boolean) : null

  const shouldFetch =
    Boolean(enabled) &&
    Boolean(open) &&
    Boolean(facilityCode) &&
    (query.length === 0 || query.length >= 2)

  return useQuery({
    queryKey: omniSearchKeys.results({
      facilityCode,
      q: query,
      types: effectiveTypes,
      limit,
    }),
    queryFn: () =>
      omniSearchApi.search({
        q: query,
        types: effectiveTypes,
        limit,
      }),
    enabled: shouldFetch,
    staleTime: 15 * 1000,
  })
}

