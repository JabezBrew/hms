const PRELOADERS = [
  {
    test: (pathname) => pathname === '/patients',
    load: () => import('@/features/patients/pages/PatientChronicleListPage'),
  },
  {
    test: (pathname) => /^\/patients\/[^/]+(?:\/chronicle)?\/?$/.test(pathname),
    load: () => Promise.all([
      import('@/features/patients/pages/PatientPage'),
      import('@/features/patients/pages/PatientChroniclePage'),
      import('@/components/chronicle/ClinicalSummarySidebar'),
      import('@/components/chronicle/ChronicleNoteBody'),
      import('@/features/patients/chronicle/ChronicleTimelinePanel'),
      import('@/features/patients/components/ChronicleWorkspaceHost'),
    ]),
  },
  {
    test: (pathname) => pathname === '/ward-board',
    load: () => import('@/features/ward-board/pages/WardBoardPage'),
  },
  {
    test: (pathname) => pathname === '/laboratory/orders',
    load: () => import('@/features/laboratory/pages/LabOrdersPage'),
  },
  {
    test: (pathname) => pathname === '/inventory/items',
    load: () => import('@/features/inventory/pages/ItemsPage'),
  },
  {
    test: (pathname) => pathname === '/dashboards/admin',
    load: () => import('@/features/dashboards/pages/AdminDashboard'),
  },
]

const preloadCache = new Map()

function normalizePathname(pathname) {
  if (!pathname || typeof pathname !== 'string') {
    return '/'
  }
  return pathname.split(/[?#]/)[0] || '/'
}

export function preloadCriticalRouteForPath(pathname) {
  const normalizedPathname = normalizePathname(pathname)
  const route = PRELOADERS.find((preloader) => preloader.test(normalizedPathname))

  if (!route) {
    return null
  }

  // Chunks are shared by route type. Keying on patient paths would retain
  // identifiers and grow the cache for every patient opened during a shift.
  if (preloadCache.has(route)) {
    return preloadCache.get(route)
  }

  const promise = Promise.resolve()
    .then(() => route.load())
    .catch(() => {
      preloadCache.delete(route)
    })

  preloadCache.set(route, promise)
  return promise
}
