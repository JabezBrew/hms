import { lazy } from 'react'
import { ROUTE_LAYOUTS } from '@/app/routes/routeTypes'
import { ROLES, ROLE_GROUPS } from '@/shared/constants/roles'

const DoctorDashboard = lazy(() => import('./pages/DoctorDashboard'))
const ProviderDashboard = lazy(() => import('./pages/ProviderDashboard'))
const InpatientDoctorDashboard = lazy(() => import('./pages/InpatientDoctorDashboard'))
const ReceptionistDashboard = lazy(() => import('./pages/ReceptionistDashboard'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const RoleDashboard = lazy(() => import('./pages/RoleDashboard'))

const DASHBOARDS_BREADCRUMB = { label: 'Dashboards', path: '/' }

export const dashboardRoutes = [
  {
    path: '/',
    component: RoleDashboard,
    roles: null,
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Dashboard | Hospital Management System',
    breadcrumbs: [DASHBOARDS_BREADCRUMB],
  },
  {
    path: '/dashboards/inpatient',
    component: InpatientDoctorDashboard,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.PHYSICIAN, ROLES.PRACTITIONER],
    features: ['inpatient_admissions'],
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Inpatient Dashboard | Hospital Management System',
    breadcrumbs: [DASHBOARDS_BREADCRUMB, { label: 'Inpatient', path: '/dashboards/inpatient' }],
  },
  {
    path: '/dashboards/reception',
    component: ReceptionistDashboard,
    roles: [ROLES.ADMIN, ROLES.RECEPTIONIST],
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Reception Dashboard | Hospital Management System',
    breadcrumbs: [DASHBOARDS_BREADCRUMB, { label: 'Reception', path: '/dashboards/reception' }],
  },
  {
    path: '/dashboards/admin',
    component: AdminDashboard,
    roles: ROLE_GROUPS.ADMIN_ONLY,
    layout: ROUTE_LAYOUTS.BARE,
    title: 'Admin Dashboard | Hospital Management System',
    breadcrumbs: [DASHBOARDS_BREADCRUMB, { label: 'Admin', path: '/dashboards/admin' }],
  },
  {
    path: '/dashboard/doctor',
    component: DoctorDashboard,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.PHYSICIAN, ROLES.PRACTITIONER],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Doctor Dashboard | Hospital Management System',
    breadcrumbs: [DASHBOARDS_BREADCRUMB, { label: 'Doctor', path: '/dashboard/doctor' }],
  },
  {
    path: '/dashboard/provider',
    component: ProviderDashboard,
    roles: [ROLES.ADMIN, ROLES.DOCTOR, ROLES.NURSE, ROLES.PRACTITIONER, ROLES.PHYSICIAN],
    layout: ROUTE_LAYOUTS.APP,
    title: 'Provider Dashboard | Hospital Management System',
    breadcrumbs: [DASHBOARDS_BREADCRUMB, { label: 'Provider', path: '/dashboard/provider' }],
  },
]
