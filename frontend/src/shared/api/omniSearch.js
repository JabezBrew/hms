import { apiClient } from '@/lib/api-client'

export const omniSearchApi = {
  search: ({ q, types, limit } = {}) => {
    const params = {}
    if (q !== undefined && q !== null) {
      params.q = String(q)
    }
    if (Array.isArray(types) && types.length > 0) {
      params.types = types.join(',')
    }
    if (limit !== undefined && limit !== null) {
      params.limit = limit
    }
    return apiClient.get('/search/omni/', { params })
  },
}
