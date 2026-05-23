import { lazy } from 'react'
import { ROUTE_LAYOUTS, SIDEBARS } from '@/app/routes/routeTypes'
import { ADMIN_CAPABILITIES } from '@/shared/constants/roles'

const OpsDashboardPage = lazy(() => import('./pages/OpsDashboardPage'))

const SYSTEM_BREADCRUMB = { label: 'System', path: '/system/ops' }

export const opsRoutes = [
  {
    path: '/system/ops',
    component: OpsDashboardPage,
    roles: [],
    capabilities: [ADMIN_CAPABILITIES.SYSTEM_OPS_VIEW],
    layout: ROUTE_LAYOUTS.APP,
    sidebar: SIDEBARS.ADMIN,
    title: 'Ops Dashboard | Hospital Management System',
    breadcrumbs: [SYSTEM_BREADCRUMB, { label: 'Ops Dashboard', path: '/system/ops' }],
  },
]
