import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES } from '@/shared/constants/roles'

const ClinicWaitingRoomPage = lazy(() => import('./pages/ClinicWaitingRoomPage'))

export const clinicRoutes = [
  {
    path: '/clinics/:clinicId/waiting-room',
    component: ClinicWaitingRoomPage,
    roles: [
      ROLES.ADMIN,
      ROLES.DOCTOR,
      ROLES.NURSE,
      ROLES.RECEPTIONIST,
      ROLES.HEAD_NURSE,
      ROLES.NURSE_PRACTITIONER,
      ROLES.PHYSICIAN,
      ROLES.PRACTITIONER,
    ],
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Clinic Waiting Room | Hospital Management System',
    breadcrumbs: [{ label: 'Clinic Waiting Room', path: '/clinics/:clinicId/waiting-room' }],
  },
]
