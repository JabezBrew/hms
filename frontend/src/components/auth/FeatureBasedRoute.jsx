import { Navigate } from 'react-router-dom'
import { useSystemCapabilities } from '@/hooks/useSystemQueries'
import { PageLoader } from '@/shared/components/page/PageState'
import { areFeaturesEnabled, featureList } from '@/shared/lib/features'

export function FeatureBasedRoute({ children, features, redirectTo = '/feature-unavailable' }) {
  const requiredFeatures = featureList(features)
  const hasFeatureRequirements = requiredFeatures.length > 0
  const {
    data: deploymentCapabilities,
    isLoading,
    isPending,
  } = useSystemCapabilities({ enabled: hasFeatureRequirements })

  if (!hasFeatureRequirements) {
    return children
  }

  if (!deploymentCapabilities && (isLoading || isPending)) {
    return <PageLoader rows={3} />
  }

  if (areFeaturesEnabled(requiredFeatures, deploymentCapabilities?.features)) {
    return children
  }

  return <Navigate to={redirectTo} replace />
}
