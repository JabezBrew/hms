export function featureList(features) {
  if (!features) return []
  return Array.isArray(features) ? features : [features]
}

export function areFeaturesEnabled(requiredFeatures, enabledFeatures = {}) {
  const required = featureList(requiredFeatures)
  if (required.length === 0) return true

  return required.every((feature) => enabledFeatures?.[feature] === true)
}

export function withFeature(routes, features) {
  return routes.map((route) => ({
    ...route,
    features: Array.from(new Set([
      ...featureList(route.features),
      ...featureList(typeof features === 'function' ? features(route) : features),
    ])),
  }))
}
