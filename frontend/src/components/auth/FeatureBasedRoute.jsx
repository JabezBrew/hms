import { Navigate } from 'react-router-dom'
import { useSystemCapabilities } from '@/hooks/useSystemQueries'
import { areFeaturesEnabled } from '@/shared/lib/features'

export function FeatureBasedRoute({ children, features, redirectTo = '/feature-unavailable' }) {
  const { data: deploymentCapabilities } = useSystemCapabilities()
  const enabledFeatures = deploymentCapabilities?.features

  if (!features || !enabledFeatures) {
    return children
  }

  if (areFeaturesEnabled(features, enabledFeatures)) {
    return children
  }

  return <Navigate to={redirectTo} replace />
}
