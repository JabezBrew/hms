import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES, ROLE_GROUPS } from '@/shared/constants/roles'

const NursingDashboardPage = lazy(() => import('./pages/NursingDashboardPage'))
const TreatmentSheetPage = lazy(() => import('./pages/TreatmentSheetPage'))
const ShiftHandoffPage = lazy(() => import('./pages/ShiftHandoffPage'))
const NursingTasksPage = lazy(() => import('./pages/NursingTasksPage'))
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
    path: '/nursing/treatment-sheet',
    component: TreatmentSheetPage,
    roles: [ROLES.ADMIN, ROLES.NURSE, ROLES.DOCTOR, ROLES.HEAD_NURSE, ROLES.NURSE_PRACTITIONER],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Treatment Sheet | Hospital Management System',
    breadcrumbs: [NURSING_BREADCRUMB, { label: 'Treatment Sheet', path: '/nursing/treatment-sheet' }],
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
    path: '/nursing/discharges',
    component: NursingDischargesPage,
    roles: ROLE_GROUPS.NURSING_DASHBOARD,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Nursing Discharges | Hospital Management System',
    breadcrumbs: [NURSING_BREADCRUMB, { label: 'Discharges', path: '/nursing/discharges' }],
  },
]
