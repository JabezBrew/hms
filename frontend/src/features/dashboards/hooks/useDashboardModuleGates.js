import { useMemo } from 'react'

import { useSystemCapabilities } from '@/hooks/useSystemQueries'
import { buildDashboardFeatureGates } from '@/features/dashboards/utils/moduleGates'

const EMPTY_FEATURES = {}

export function useDashboardModuleGates(options = {}) {
  const capabilitiesQuery = useSystemCapabilities(options)
  const enabledFeatures = capabilitiesQuery.data?.features || EMPTY_FEATURES
  const hasFeatureMap = Boolean(capabilitiesQuery.data?.features)
  const isResolving = !hasFeatureMap && (capabilitiesQuery.isLoading || capabilitiesQuery.isPending)
  const gates = useMemo(
    () => buildDashboardFeatureGates(enabledFeatures),
    [enabledFeatures],
  )

  return {
    ...capabilitiesQuery,
    ...gates,
    enabledFeatures,
    hasFeatureMap,
    isResolving,
  }
}
