import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'

const InboxPage = lazy(() => import('./pages/InboxPage'))

export const inboxRoutes = [
  {
    path: '/inbox',
    component: InboxPage,
    roles: [
      ROLES.ADMIN,
      ROLES.DOCTOR,
      ROLES.NURSE,
      ROLES.INPATIENT_DOCTOR,
      ROLES.PRACTITIONER,
      ROLES.PHYSICIAN,
    ],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Inbox | Hospital Management System',
    breadcrumbs: [{ label: 'Inbox', path: '/inbox' }],
  },
]
