import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS } from '@/shared/constants/roles'

const NursingDashboardPage = lazy(() => import('./pages/NursingDashboardPage'))
const ShiftHandoffPage = lazy(() => import('./pages/ShiftHandoffPage'))
const NursingTasksPage = lazy(() => import('./pages/NursingTasksPage'))
const WardStockRequestsPage = lazy(() => import('./pages/WardStockRequestsPage'))
const NursingDischargesPage = lazy(() => import('@/features/discharge/pages/NursingDischargesPage'))

const NURSING_BREADCRUMB = { label: 'Nursing', path: '/nursing/dashboard' }

export const nursingRoutes = [
  {
    path: '/nursing/dashboard',
    component: NursingDashboardPage,
    roles: ROLE_GROUPS.NURSING_DASHBOARD,
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Nursing Dashboard | Hospital Management System',
    breadcrumbs: [NURSING_BREADCRUMB],
  },
  {
    path: '/nursing/shift-handoff',
    component: ShiftHandoffPage,
    roles: ROLE_GROUPS.NURSING_DASHBOARD,
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Shift Handoff | Hospital Management System',
    breadcrumbs: [NURSING_BREADCRUMB, { label: 'Shift Handoff', path: '/nursing/shift-handoff' }],
  },
  {
    path: '/nursing/tasks',
    component: NursingTasksPage,
    roles: ROLE_GROUPS.NURSING_DASHBOARD,
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Nursing Tasks | Hospital Management System',
    breadcrumbs: [NURSING_BREADCRUMB, { label: 'Tasks', path: '/nursing/tasks' }],
  },
  {
    path: '/nursing/ward-stock-requests',
    component: WardStockRequestsPage,
    roles: ROLE_GROUPS.NURSING_DASHBOARD,
    features: ['nursing_workflows', 'inventory'],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Ward Stock Requests | Hospital Management System',
    breadcrumbs: [NURSING_BREADCRUMB, { label: 'Ward Stock Requests', path: '/nursing/ward-stock-requests' }],
  },
  {
    path: '/nursing/discharges',
    component: NursingDischargesPage,
    roles: ROLE_GROUPS.NURSING_DASHBOARD,
    features: ['discharge_workflows'],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Nursing Discharges | Hospital Management System',
    breadcrumbs: [NURSING_BREADCRUMB, { label: 'Discharges', path: '/nursing/discharges' }],
  },
]
