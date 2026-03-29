import { useQuery } from '@tanstack/react-query'
import { immutableMetadataQueryOptions } from '@/lib/react-query'
import { systemApi } from '@/shared/api/system'
import { keyWith } from '@/shared/lib/queryKeys'

const systemKeys = {
  deploymentCapabilities: () => keyWith('system', 'deployment-capabilities'),
}

export function useSystemCapabilities(options = {}) {
  return useQuery({
    queryKey: systemKeys.deploymentCapabilities(),
    queryFn: () => systemApi.getDeploymentCapabilities(),
    ...immutableMetadataQueryOptions(),
    ...options,
  })
}
