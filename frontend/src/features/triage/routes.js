import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'

const TriagePage = lazy(() => import('./pages/TriagePage'))

export const triageRoutes = [
  {
    path: '/triage',
    component: TriagePage,
    roles: [ROLES.ADMIN, ROLES.NURSE, ROLES.RECEPTIONIST, ROLES.HEAD_NURSE, ROLES.NURSE_PRACTITIONER],
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Triage | Hospital Management System',
    breadcrumbs: [{ label: 'Triage', path: '/triage' }],
  },
]
