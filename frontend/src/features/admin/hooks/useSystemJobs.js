import { useQuery } from '@tanstack/react-query'

import { apiClient } from '@/lib/api-client'
import { keyWith } from '@/shared/lib/queryKeys'

export const adminJobsKeys = {
  detail: () => keyWith('admin', 'system-jobs'),
}

async function fetchSystemJobs() {
  return apiClient.get('/system/jobs/')
}

export function useSystemJobs({ refetchInterval = 30000 } = {}) {
  return useQuery({
    queryKey: adminJobsKeys.detail(),
    queryFn: fetchSystemJobs,
    staleTime: 15000,
    refetchInterval,
    refetchIntervalInBackground: false,
    retry: 1,
  })
}
