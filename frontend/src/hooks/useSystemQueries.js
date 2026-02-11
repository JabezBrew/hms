import { useQuery } from '@tanstack/react-query'
import { systemApi } from '@/shared/api/system'
import { keyWith } from '@/shared/lib/queryKeys'

const systemKeys = {
  deploymentCapabilities: () => keyWith('system', 'deployment-capabilities'),
}

export function useSystemCapabilities(options = {}) {
  return useQuery({
    queryKey: systemKeys.deploymentCapabilities(),
    queryFn: () => systemApi.getDeploymentCapabilities(),
    staleTime: 5 * 60 * 1000,
    ...options,
  })
}
