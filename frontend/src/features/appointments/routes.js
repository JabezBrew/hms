import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS } from '@/shared/constants/roles'

const AppointmentsPage = lazy(() => import('./pages/AppointmentsPage'))
const AppointmentCreatePage = lazy(() => import('./pages/AppointmentCreatePage'))
const AppointmentDetailPage = lazy(() => import('./pages/AppointmentDetailPage'))
const AppointmentEditPage = lazy(() => import('./pages/AppointmentEditPage'))
const PractitionerAvailabilityPage = lazy(() => import('./pages/PractitionerAvailabilityPage'))
const ScheduleSlotsPage = lazy(() => import('./pages/ScheduleSlotsPage'))

export const appointmentRoutes = [
  {
    path: '/appointments',
    component: AppointmentsPage,
    roles: ROLE_GROUPS.APPOINTMENTS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Schedule | Hospital Management System',
    breadcrumbs: [{ label: 'Schedule', path: '/appointments' }],
  },
  {
    path: '/appointments/create',
    component: AppointmentCreatePage,
    roles: ROLE_GROUPS.APPOINTMENTS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'New Appointment | Hospital Management System',
    breadcrumbs: [
      { label: 'Schedule', path: '/appointments' },
      { label: 'New Appointment', path: '/appointments/create' },
    ],
  },
  {
    path: '/appointments/:id',
    component: AppointmentDetailPage,
    roles: ROLE_GROUPS.APPOINTMENTS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Appointment Details | Hospital Management System',
    breadcrumbs: [
      { label: 'Schedule', path: '/appointments' },
      { label: 'Appointment', path: '/appointments/:id' },
    ],
  },
  {
    path: '/appointments/:id/edit',
    component: AppointmentEditPage,
    roles: ROLE_GROUPS.APPOINTMENTS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Edit Appointment | Hospital Management System',
    breadcrumbs: [
      { label: 'Schedule', path: '/appointments' },
      { label: 'Edit Appointment', path: '/appointments/:id/edit' },
    ],
  },
  {
    path: '/practitioner-availability',
    component: PractitionerAvailabilityPage,
    roles: ROLE_GROUPS.PRACTITIONER_AVAILABILITY,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Practitioner Availability | Hospital Management System',
    breadcrumbs: [{ label: 'Availability', path: '/practitioner-availability' }],
  },
  {
    path: '/schedules/:id/slots',
    component: ScheduleSlotsPage,
    roles: ROLE_GROUPS.APPOINTMENTS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Schedule Slots | Hospital Management System',
    breadcrumbs: [
      { label: 'Availability', path: '/practitioner-availability' },
      { label: 'Schedule Slots', path: '/schedules/:id/slots' },
    ],
  },
]
