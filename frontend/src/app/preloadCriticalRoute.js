const PRELOADERS = [
  {
    test: (pathname) => pathname === '/patients',
    load: () => import('@/features/patients/pages/PatientChronicleListPage'),
  },
  {
    test: (pathname) => /^\/patients\/[^/]+\/?$/.test(pathname),
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
  return pathname.split('?')[0] || '/'
}

export function preloadCriticalRouteForPath(pathname) {
  const normalizedPathname = normalizePathname(pathname)
  const route = PRELOADERS.find((preloader) => preloader.test(normalizedPathname))

  if (!route) {
    return null
  }

  if (preloadCache.has(normalizedPathname)) {
    return preloadCache.get(normalizedPathname)
  }

  const promise = Promise.resolve()
    .then(() => route.load())
    .catch(() => {
      preloadCache.delete(normalizedPathname)
    })

  preloadCache.set(normalizedPathname, promise)
  return promise
}
