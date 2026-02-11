import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS } from '@/shared/constants/roles'

const AdmissionCreatePage = lazy(() => import('./pages/AdmissionCreatePage'))
const AdmissionDetailPage = lazy(() => import('./pages/AdmissionDetailPage'))

export const admissionRoutes = [
  {
    path: '/admissions/new',
    component: AdmissionCreatePage,
    roles: ROLE_GROUPS.ADMISSIONS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'New Admission | Hospital Management System',
    breadcrumbs: [
      { label: 'Admissions', path: '/admissions/new' },
    ],
  },
  {
    path: '/admissions/:admissionId',
    component: AdmissionDetailPage,
    roles: ROLE_GROUPS.ADMISSIONS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Admission | Hospital Management System',
    breadcrumbs: [
      { label: 'Admissions', path: '/admissions/:admissionId' },
    ],
  },
]
