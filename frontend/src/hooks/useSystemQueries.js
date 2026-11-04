import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { AuthContext } from '@/lib/auth/AuthContext'
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client'
import { isRustV2ApiMode } from '@/lib/api/v2/runtime'
import { requestAuthorizationScope } from '@/shared/lib/authorizationScope'
import { userHasCapability } from '@/shared/lib/access'
import { immutableMetadataQueryOptions } from '@/lib/react-query'
import { systemApi } from '@/shared/api/system'
import { keyWith } from '@/shared/lib/queryKeys'

const systemKeys = {
  deploymentCapabilities: () => keyWith('system', 'deployment-capabilities'),
  featureEntitlements: (params = {}) => keyWith('system', 'feature-entitlements', params),
}

export function useSystemCapabilities(options = {}) {
  const auth = useContext(AuthContext), user = auth?.user, rust = isRustV2ApiMode()
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey)
  const admitted = !rust || Boolean(auth?.isAuthenticated !== false && auth?.sessionReady !== false && user?.id && user?.accessContext?.facility_id && user?.accessContext?.active_profile && userHasCapability(user, 'system.deployment_capabilities.view'))
  const scope = rust ? requestAuthorizationScope(user, transport) : null, live = useRef(null)
  useLayoutEffect(() => {
    const lease = { scope, active: admitted, transport }; live.current = lease
    return () => { lease.active = false }
  }, [scope, admitted, transport])
  const queryOptions = {
    queryKey: systemKeys.deploymentCapabilities(),
    queryFn: ({ signal }) => systemApi.getDeploymentCapabilities({ signal }),
    ...immutableMetadataQueryOptions(),
    ...options,
  }
  const callerEnabled = options.enabled
  const query = useQuery(rust ? {
    ...queryOptions,
    // One endpoint has one admission rule across sidebar, switcher, search and
    // route consumers. Caller options cannot replace its identity or authority.
    queryKey: [...systemKeys.deploymentCapabilities(), scope],
    enabled: typeof callerEnabled === 'function' ? value => admitted && callerEnabled(value) : admitted && callerEnabled !== false,
    initialData: undefined, placeholderData: undefined,
    queryFn: async ({ signal }) => {
      const lease = live.current
      const current = () => lease?.active && live.current === lease && lease.scope === scope && lease.transport === getV2ClientScopeKey() && !signal.aborted
      if (!current()) throw new DOMException('Aborted', 'AbortError')
      const value = await systemApi.getDeploymentCapabilities({ signal })
      if (!current()) throw new DOMException('Aborted', 'AbortError')
      return value
    },
  } : queryOptions)
  if (rust && !admitted) return { ...query, data: undefined, error: null, isError: false, isSuccess: false, admissionDenied: true }
  return { ...query, admissionDenied: false }
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
