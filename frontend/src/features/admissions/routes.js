import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLE_GROUPS, combineRoles } from '@/shared/constants/roles'

const AdmissionCreatePage = lazy(() => import('./pages/AdmissionCreatePage'))
const AdmissionRequestListPage = lazy(() => import('./pages/AdmissionRequestListPage'))
const AdmissionCaseDetailPage = lazy(() => import('./pages/AdmissionCaseDetailPage'))
const BillingAdmissionQueuePage = lazy(() => import('./pages/BillingAdmissionQueuePage'))
const AdmissionDetailPage = lazy(() => import('./pages/AdmissionDetailPage'))

export const admissionRoutes = [
  {
    path: '/admissions/requests',
    component: AdmissionRequestListPage,
    roles: ROLE_GROUPS.ADMISSIONS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Admission Requests | Hospital Management System',
    breadcrumbs: [
      { label: 'Admissions', path: '/admissions/requests' },
    ],
  },
  {
    path: '/admissions/new',
    component: AdmissionCreatePage,
    roles: ROLE_GROUPS.ADMISSIONS,
    layout: ROUTE_LAYOUTS.APP,
    title: 'Start Admission | Hospital Management System',
    breadcrumbs: [
      { label: 'Admissions', path: '/admissions/requests' },
      { label: 'Start Admission', path: '/admissions/new' },
    ],
  },
  {
    path: '/admissions/cases/:caseId',
    component: AdmissionCaseDetailPage,
    roles: combineRoles(ROLE_GROUPS.ADMISSIONS, ROLE_GROUPS.BILLING, ROLE_GROUPS.NURSING_WORKFLOW),
    layout: ROUTE_LAYOUTS.APP,
    title: 'Admission Case | Hospital Management System',
    breadcrumbs: [
      { label: 'Admissions', path: '/admissions/requests' },
      { label: 'Admission Case', path: '/admissions/cases/:caseId' },
    ],
  },
  {
    path: '/billing/admissions',
    component: BillingAdmissionQueuePage,
    roles: ROLE_GROUPS.BILLING,
    features: ['billing'],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Billing Admission Queue | Hospital Management System',
    breadcrumbs: [
      { label: 'Billing', path: '/billing/admissions' },
      { label: 'Admissions', path: '/billing/admissions' },
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
