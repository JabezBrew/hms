import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ADMIN_CAPABILITIES, ROLE_GROUPS } from '@/shared/constants/roles'

const StaffListPage = lazy(() => import('./pages/StaffListPage'))
const StaffCreatePage = lazy(() => import('./pages/StaffCreatePage'))
const StaffDetailPage = lazy(() => import('./pages/StaffDetailPage'))

const STAFF_BREADCRUMB = { label: 'Staff', path: '/staff' }

export const staffRoutes = [
  {
    path: '/staff',
    component: StaffListPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    capabilities: [ADMIN_CAPABILITIES.STAFF_VIEW],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Staff Directory | Hospital Management System',
    breadcrumbs: [STAFF_BREADCRUMB],
  },
  {
    path: '/staff/create',
    component: StaffCreatePage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    capabilities: [ADMIN_CAPABILITIES.ORGANIZATION_MANAGE],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Add Staff | Hospital Management System',
    breadcrumbs: [STAFF_BREADCRUMB, { label: 'New Staff', path: '/staff/create' }],
  },
  {
    path: '/staff/:id',
    component: StaffDetailPage,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    capabilities: [ADMIN_CAPABILITIES.STAFF_VIEW],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Staff Profile | Hospital Management System',
    breadcrumbs: [STAFF_BREADCRUMB, { label: 'Staff Profile', path: '/staff/:id' }],
  },
]
