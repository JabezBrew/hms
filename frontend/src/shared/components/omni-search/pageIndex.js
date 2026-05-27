import { featureRoutes } from '@/app/routes/featureRoutes'

function normalizeRole(role) {
  return role ? String(role).trim() : ''
}

function normalizeTitle(title) {
  if (!title) return null
  const raw = String(title)
  // Common pattern: "Foo | Hospital Management System"
  const head = raw.split('|')[0]
  return head.trim() || raw.trim()
}

function routeLabel(route) {
  const crumbs = Array.isArray(route?.breadcrumbs) ? route.breadcrumbs : []
  for (let i = crumbs.length - 1; i >= 0; i -= 1) {
    const label = crumbs[i]?.label
    if (label) return String(label)
  }

  const title = normalizeTitle(route?.title)
  if (title) return title

  return route?.path || ''
}

function toKeywords(route) {
  const keywords = new Set()

  const crumbs = Array.isArray(route?.breadcrumbs) ? route.breadcrumbs : []
  for (const crumb of crumbs) {
    if (crumb?.label) keywords.add(String(crumb.label).toLowerCase())
  }

  const title = normalizeTitle(route?.title)
  if (title) keywords.add(title.toLowerCase())

  const path = route?.path || ''
  for (const token of String(path).split('/')) {
    if (!token) continue
    keywords.add(token.toLowerCase())
  }

  return Array.from(keywords)
}

function isStaticPath(path) {
  return Boolean(path) && !String(path).includes(':')
}

function roleAllowsRoute(route, role) {
  const roles = route?.roles
  if (!roles || roles.length === 0) return true
  return roles.includes(role)
}

const ALL_STATIC_PAGES = Object.freeze(
  featureRoutes.reduce((pages, route) => {
    if (!isStaticPath(route?.path)) return pages
    pages.push({
      id: route.path,
      path: route.path,
      label: routeLabel(route),
      keywords: toKeywords(route),
      roles: route.roles,
    })
    return pages
  }, [])
)

const pagesByRoleCache = new Map()
const pathSetByRoleCache = new Map()
const pathLabelByRoleCache = new Map()

export function getStaticPagesForRole(role) {
  const normalizedRole = normalizeRole(role)
  if (pagesByRoleCache.has(normalizedRole)) {
    return pagesByRoleCache.get(normalizedRole)
  }

  const pages = ALL_STATIC_PAGES.filter((page) => roleAllowsRoute(page, normalizedRole))
  pagesByRoleCache.set(normalizedRole, pages)
  return pages
}

export function getStaticPathSetForRole(role) {
  const normalizedRole = normalizeRole(role)
  if (pathSetByRoleCache.has(normalizedRole)) {
    return pathSetByRoleCache.get(normalizedRole)
  }

  const set = new Set(getStaticPagesForRole(normalizedRole).map((page) => page.path))
  pathSetByRoleCache.set(normalizedRole, set)
  return set
}

export function getStaticPathLabelMapForRole(role) {
  const normalizedRole = normalizeRole(role)
  if (pathLabelByRoleCache.has(normalizedRole)) {
    return pathLabelByRoleCache.get(normalizedRole)
  }

  const map = new Map()
  for (const page of getStaticPagesForRole(normalizedRole)) {
    map.set(page.path, page.label)
  }
  pathLabelByRoleCache.set(normalizedRole, map)
  return map
}
