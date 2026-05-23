import { useQuery } from '@tanstack/react-query'
import { opsApi } from '@/features/ops/api'
import { createKeyFactory } from '@/shared/lib/queryKeys'

const baseKeys = createKeyFactory('ops')

export const opsKeys = {
  ...baseKeys,
  dashboard: (params = {}) => [...baseKeys.all, 'dashboard', { params }],
}

export function useOpsDashboard(params = {}, options = {}) {
  return useQuery({
    queryKey: opsKeys.dashboard(params),
    queryFn: ({ signal }) => opsApi.getDashboard(params, { signal }),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    ...options,
  })
}
