import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { immutableMetadataQueryOptions } from '@/lib/react-query'
import { systemApi } from '@/shared/api/system'
import { keyWith } from '@/shared/lib/queryKeys'

const systemKeys = {
  deploymentCapabilities: () => keyWith('system', 'deployment-capabilities'),
  featureEntitlements: (params = {}) => keyWith('system', 'feature-entitlements', params),
}

export function useSystemCapabilities(options = {}) {
  return useQuery({
    queryKey: systemKeys.deploymentCapabilities(),
    queryFn: ({ signal }) => systemApi.getDeploymentCapabilities({ signal }),
    ...immutableMetadataQueryOptions(),
    ...options,
  })
}

export function useFeatureEntitlements(params = {}, options = {}) {
  return useQuery({
    queryKey: systemKeys.featureEntitlements(params),
    queryFn: ({ signal }) => systemApi.getFeatureEntitlements(params, { signal }),
    staleTime: 30 * 1000,
    ...options,
  })
}

function useEntitlementMutation(mutationFn) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keyWith('system', 'deployment-capabilities') })
      queryClient.invalidateQueries({ queryKey: keyWith('system', 'feature-entitlements') })
    },
  })
}

export function useCreateFeatureEntitlement() {
  return useEntitlementMutation(systemApi.createFeatureEntitlement)
}

export function useUpdateFeatureEntitlement() {
  return useEntitlementMutation(({ id, data }) => systemApi.updateFeatureEntitlement(id, data))
}

export function useDeleteFeatureEntitlement() {
  return useEntitlementMutation(systemApi.deleteFeatureEntitlement)
}
