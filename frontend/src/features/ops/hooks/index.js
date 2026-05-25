import { useQuery } from '@tanstack/react-query'
import { opsApi } from '@/features/ops/api'
import { createKeyFactory } from '@/shared/lib/queryKeys'

const baseKeys = createKeyFactory('ops')

export const opsKeys = {
  ...baseKeys,
  overview: (params = {}) => [...baseKeys.all, 'overview', { params }],
  performance: (params = {}) => [...baseKeys.all, 'performance', { params }],
  database: (params = {}) => [...baseKeys.all, 'database', { params }],
  frontend: (params = {}) => [...baseKeys.all, 'frontend', { params }],
  dashboard: (params = {}) => [...baseKeys.all, 'overview', { params }],
}

export function useOpsOverview(params = {}, options = {}) {
  return useQuery({
    queryKey: opsKeys.overview(params),
    queryFn: ({ signal }) => opsApi.getOverview(params, { signal }),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    ...options,
  })
}

export function useOpsPerformance(params = {}, options = {}) {
  return useQuery({
    queryKey: opsKeys.performance(params),
    queryFn: ({ signal }) => opsApi.getPerformance(params, { signal }),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    ...options,
  })
}

export function useOpsDatabase(params = {}, options = {}) {
  return useQuery({
    queryKey: opsKeys.database(params),
    queryFn: ({ signal }) => opsApi.getDatabase(params, { signal }),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    ...options,
  })
}

export function useOpsFrontend(params = {}, options = {}) {
  return useQuery({
    queryKey: opsKeys.frontend(params),
    queryFn: ({ signal }) => opsApi.getFrontend(params, { signal }),
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
    ...options,
  })
}

export function useOpsDashboard(params = {}, options = {}) {
  return useOpsOverview(params, options)
}
